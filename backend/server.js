// ============================================================
// server.js — Skribbl Clone Backend
// NEW FEATURES vs previous version:
//   - kick_player: host can forcibly remove a player from lobby OR game
//   - vote_kick:   during a game, players can vote to kick someone
//                  (majority vote = kicked; host vote = instant kick)
//   - toggle_visibility: host can flip room between public/private in lobby
//   - leave_room:  player explicitly leaves (vs just closing tab)
//                  Both lobby and game supported.
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = {};

const WORD_LIST = [
  "elephant", "pizza", "guitar", "rainbow", "bicycle",
  "castle", "dragon", "umbrella", "volcano", "penguin",
  "robot", "sandwich", "tornado", "mermaid", "spaceship",
  "cactus", "lighthouse", "snowflake", "treasure", "wizard",
  "kangaroo", "spaghetti", "telescope", "waterfall", "compass",
  "jellyfish", "parachute", "symphony", "labyrinth", "giraffe",
  "astronaut", "butterfly", "crocodile", "dinosaur", "fireworks",
  "hurricane", "microscope", "pineapple", "scorpion", "submarine",
];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomWord() {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

// Returns N unique random words from the word list
function getRandomWords(count) {
  const shuffled = [...WORD_LIST].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function getCurrentDrawer(room) {
  return room.players[room.currentDrawerIndex];
}

// ----------------------------------------------------------
// buildHintMask — produces a "_ _ e _ h _ n t" style string
// showing only the letters whose indices are in revealedIndices.
// ----------------------------------------------------------
function buildHintMask(word, revealedIndices) {
  return word
    .split("")
    .map((char, i) => {
      if (char === " ") return "  ";
      return revealedIndices.has(i) ? char : "_";
    })
    .join(" ");
}

// ----------------------------------------------------------
// scheduleHints — progressively reveals letters during a round.
// First hint fires at 40% of round time, then on an interval.
// ----------------------------------------------------------
function scheduleHints(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const word = room.currentWord;
  const nonSpaceIndices = word
    .split("")
    .map((c, i) => (c !== " " ? i : null))
    .filter((i) => i !== null);

  // Shuffle indices so revealed letters are random
  for (let i = nonSpaceIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nonSpaceIndices[i], nonSpaceIndices[j]] = [nonSpaceIndices[j], nonSpaceIndices[i]];
  }

  const maxHints = Math.max(1, Math.floor(nonSpaceIndices.length / 2));
  const firstHintAt = Math.floor(room.roundDuration * 0.4) * 1000;
  const hintInterval = Math.floor((room.roundDuration * 0.5) / maxHints) * 1000;

  room.hintRevealedIndices = new Set();
  room.hintCount = 0;

  room.hintFirstTimeout = setTimeout(() => {
    revealNextHint();
    room.hintTimer = setInterval(() => {
      revealNextHint();
    }, hintInterval);
  }, firstHintAt);

  function revealNextHint() {
    const r = rooms[roomId];
    if (!r || r.gameState !== "playing") return;
    if (r.hintCount >= maxHints) {
      if (r.hintTimer) { clearInterval(r.hintTimer); r.hintTimer = null; }
      return;
    }

    const nextIdx = nonSpaceIndices[r.hintCount];
    r.hintRevealedIndices.add(nextIdx);
    r.hintCount++;

    const mask = buildHintMask(word, r.hintRevealedIndices);
    const drawer = getCurrentDrawer(r);

    // Send hint only to non-drawers
    r.players.forEach((p) => {
      if (p.id !== drawer.id) io.to(p.id).emit("hint_update", { hint: mask });
    });

    io.to(roomId).emit("chat_message", {
      senderName: "💡 Hint",
      message: mask,
    });
  }
}

// ----------------------------------------------------------
// startRound — begin a new drawing turn.
// Phase 1: Send 5 word choices to the drawer; others see "picking".
// Phase 2 (beginDrawing): drawer picks a word → timer starts.
// ----------------------------------------------------------
function startRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Clear previous timers
  if (room.roundTimer) { clearInterval(room.roundTimer); room.roundTimer = null; }
  if (room.hintTimer) { clearInterval(room.hintTimer); room.hintTimer = null; }
  if (room.hintFirstTimeout) { clearTimeout(room.hintFirstTimeout); room.hintFirstTimeout = null; }
  if (room.wordChoiceTimeout) { clearTimeout(room.wordChoiceTimeout); room.wordChoiceTimeout = null; }

  room.currentWord = null;
  room.gameState = "picking"; // new phase
  room.hintRevealedIndices = new Set();
  room.hintCount = 0;
  room.voteKick = null;

  const drawer = getCurrentDrawer(room);
  const wordChoices = getRandomWords(5);
  room.wordChoices = wordChoices; // store so we can auto-pick if drawer doesn't choose

  console.log(`[Room ${roomId}] Round ${room.roundNumber} | Drawer: ${drawer.name} | Choices: ${wordChoices.join(", ")}`);

  // Tell everyone a new round is pending (no timer yet)
  io.to(roomId).emit("round_picking", {
    drawerName: drawer.name,
    drawerId: drawer.id,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
  });

  // Send the word choices ONLY to the drawer
  io.to(drawer.id).emit("word_choices", { words: wordChoices });

  // Auto-pick first word if drawer doesn't choose within 15 seconds
  room.wordChoiceTimeout = setTimeout(() => {
    const r = rooms[roomId];
    if (!r || r.gameState !== "picking") return;
    console.log(`[Room ${roomId}] Drawer didn't pick — auto-selecting`);
    beginDrawing(roomId, r.wordChoices[0]);
  }, 15000);
}

// ----------------------------------------------------------
// beginDrawing — called after the drawer picks a word.
// Starts the actual round timer and notifies everyone.
// ----------------------------------------------------------
function beginDrawing(roomId, chosenWord) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.wordChoiceTimeout) { clearTimeout(room.wordChoiceTimeout); room.wordChoiceTimeout = null; }

  room.currentWord = chosenWord;
  room.timeLeft = room.roundDuration;
  room.gameState = "playing";

  const drawer = getCurrentDrawer(room);
  const initialMask = buildHintMask(room.currentWord, new Set());

  console.log(`[Room ${roomId}] Round ${room.roundNumber} | Word chosen: ${room.currentWord}`);

  // Clear canvas for the new round
  io.to(roomId).emit("clear_canvas");

  io.to(roomId).emit("round_started", {
    drawerName: drawer.name,
    drawerId: drawer.id,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    timeLeft: room.timeLeft,
    wordLength: room.currentWord.length,
    hint: initialMask,
  });

  // Tell drawer their word
  io.to(drawer.id).emit("your_word", { word: room.currentWord });

  if (room.roundTimer) clearInterval(room.roundTimer);
  room.roundTimer = setInterval(() => {
    room.timeLeft -= 1;
    io.to(roomId).emit("timer_update", { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) endRound(roomId, false);
  }, 1000);

  scheduleHints(roomId);
}

// ----------------------------------------------------------
// endRound — stop timer, reveal word, queue next turn
// ----------------------------------------------------------
function endRound(roomId, wordWasGuessed) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.roundTimer) { clearInterval(room.roundTimer); room.roundTimer = null; }
  if (room.hintTimer) { clearInterval(room.hintTimer); room.hintTimer = null; }
  if (room.hintFirstTimeout) { clearTimeout(room.hintFirstTimeout); room.hintFirstTimeout = null; }

  room.voteKick = null; // clear any pending vote

  io.to(roomId).emit("round_ended", {
    word: room.currentWord,
    players: room.players,
    wordWasGuessed,
  });

  setTimeout(() => {
    const r = rooms[roomId];
    if (!r) return;
    r.currentDrawerIndex = (r.currentDrawerIndex + 1) % r.players.length;
    if (r.currentDrawerIndex === 0) r.roundNumber += 1;
    if (r.roundNumber > r.maxRounds) {
      endGame(roomId);
    } else {
      startRound(roomId);
    }
  }, 4000);
}

// ----------------------------------------------------------
// endGame — all rounds done
// ----------------------------------------------------------
function endGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameState = "ended";
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(roomId).emit("game_over", { players: sorted });
  console.log(`[Room ${roomId}] Game over!`);
}

// ----------------------------------------------------------
// removePlayerFromRoom — shared logic used by kick AND leave.
// Handles host reassignment, empty-room cleanup, and mid-game
// drawer-left handling. Does NOT disconnect the socket itself.
// ----------------------------------------------------------
function removePlayerFromRoom(socket, roomId, reason) {
  const room = rooms[roomId];
  if (!room) return;

  const wasDrawer = room.gameState === "playing" &&
    room.players[room.currentDrawerIndex]?.id === socket.id;

  // Remove from players array
  room.players = room.players.filter((p) => p.id !== socket.id);

  // Leave the Socket.IO channel
  socket.leave(roomId);
  delete socket.roomId;

  // Tell all remaining players who's left and why
  io.to(roomId).emit("player_left", { players: room.players, reason });

  // Empty room → delete
  if (room.players.length === 0) {
    if (room.roundTimer) clearInterval(room.roundTimer);
    if (room.hintTimer) clearInterval(room.hintTimer);
    if (room.hintFirstTimeout) clearTimeout(room.hintFirstTimeout);
    delete rooms[roomId];
    console.log(`[Room ${roomId}] Deleted (empty)`);
    return;
  }

  // Promote new host if host left
  if (socket.id === room.hostId && room.players.length > 0) {
    room.hostId = room.players[0].id;
    io.to(room.hostId).emit("you_are_host");
    io.to(roomId).emit("host_changed", { newHostId: room.hostId });
    console.log(`[Room ${roomId}] New host: ${room.players[0].name}`);
  }

  // If drawer left mid-game, skip round
  if (wasDrawer) {
    io.to(roomId).emit("chat_message", {
      senderName: "🔔 System",
      message: "The drawer left! Skipping to next turn...",
    });
    endRound(roomId, false);
  }
}

// ============================================================
// SOCKET.IO EVENTS
// ============================================================
io.on("connection", (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ----------------------------------------------------------
  // create_room
  // Payload: { playerName, isPublic }
  // ----------------------------------------------------------
  socket.on("create_room", ({ playerName, isPublic = false }) => {
    const roomId = generateRoomId();

    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, score: 0 }],
      gameState: "lobby",
      isPublic,
      currentWord: "",
      currentDrawerIndex: 0,
      roundNumber: 1,
      maxRounds: 3,
      maxPlayers: 8,
      roundTimer: null,
      hintTimer: null,
      hintFirstTimeout: null,
      hintRevealedIndices: new Set(),
      hintCount: 0,
      roundDuration: 80,
      timeLeft: 80,
      voteKick: null, // { targetId, targetName, votes: Set of voter socket IDs }
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = playerName;

    console.log(`[Room ${roomId}] Created by ${playerName} (${isPublic ? "public" : "private"})`);
    socket.emit("room_created", { roomId, players: rooms[roomId].players, isPublic });
  });

  // ----------------------------------------------------------
  // join_room — join by room code
  // Payload: { roomId, playerName }
  // ----------------------------------------------------------
  socket.on("join_room", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("join_error", { message: "Room not found! Check the Room ID." });
      return;
    }
    if (room.gameState !== "lobby") {
      socket.emit("join_error", { message: "Game already in progress!" });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit("join_error", { message: `Room is full! (Max ${room.maxPlayers} players)` });
      return;
    }

    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = playerName;

    console.log(`[Room ${roomId}] ${playerName} joined`);
    socket.emit("room_joined", { roomId, players: room.players, isPublic: room.isPublic });
    socket.to(roomId).emit("player_joined", { players: room.players });
  });

  // ----------------------------------------------------------
  // get_public_rooms — list open public lobbies
  // ----------------------------------------------------------
  socket.on("get_public_rooms", () => {
    const list = Object.values(rooms)
      .filter((r) => r.isPublic && r.gameState === "lobby" && r.players.length < r.maxPlayers)
      .map((r) => ({
        id: r.id,
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        maxRounds: r.maxRounds,
        roundDuration: r.roundDuration,
      }));
    socket.emit("public_rooms_list", { rooms: list });
  });

  // ----------------------------------------------------------
  // join_random — join best available public room
  // Payload: { playerName }
  // ----------------------------------------------------------
  socket.on("join_random", ({ playerName }) => {
    const available = Object.values(rooms).filter(
      (r) => r.isPublic && r.gameState === "lobby" && r.players.length < r.maxPlayers
    );
    if (available.length === 0) {
      socket.emit("join_error", { message: "No public rooms available. Create one!" });
      return;
    }
    available.sort((a, b) => b.players.length - a.players.length);
    const room = available[0];
    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(room.id);
    socket.roomId = room.id;
    socket.playerName = playerName;
    console.log(`[Room ${room.id}] ${playerName} joined via random`);
    socket.emit("room_joined", { roomId: room.id, players: room.players, isPublic: room.isPublic });
    socket.to(room.id).emit("player_joined", { players: room.players });
  });

  // ----------------------------------------------------------
  // start_game — host kicks off the game with settings
  // Payload: { maxRounds, roundDuration, maxPlayers }
  // ----------------------------------------------------------
  socket.on("start_game", (settings = {}) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit("error_message", { message: "Only the host can start the game." });
      return;
    }
    if (room.players.length < 2) {
      socket.emit("error_message", { message: "Need at least 2 players to start!" });
      return;
    }
    if (settings.maxRounds >= 1 && settings.maxRounds <= 10) room.maxRounds = settings.maxRounds;
    if (settings.roundDuration >= 20 && settings.roundDuration <= 300) {
      room.roundDuration = settings.roundDuration;
      room.timeLeft = settings.roundDuration;
    }
    if (settings.maxPlayers >= 2 && settings.maxPlayers <= 20) room.maxPlayers = settings.maxPlayers;

    startRound(roomId);
  });

  // ----------------------------------------------------------
  // leave_room — player explicitly clicks "Leave" or "Quit"
  // Works from lobby AND game screens.
  // ----------------------------------------------------------
  socket.on("leave_room", () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    console.log(`[Room ${roomId}] ${socket.playerName} left voluntarily`);

    // Tell the leaving player the leave was acknowledged
    socket.emit("left_room");

    // Remove them and handle downstream effects
    removePlayerFromRoom(socket, roomId, `${socket.playerName} left the room`);
  });

  // ----------------------------------------------------------
  // kick_player — HOST ONLY: remove a player instantly.
  // Works in lobby and game.
  // Payload: { targetId }
  // ----------------------------------------------------------
  socket.on("kick_player", ({ targetId }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    // Only the host can directly kick
    if (socket.id !== room.hostId) {
      socket.emit("error_message", { message: "Only the host can kick players." });
      return;
    }

    // Can't kick yourself
    if (targetId === socket.id) {
      socket.emit("error_message", { message: "You can't kick yourself!" });
      return;
    }

    const targetPlayer = room.players.find((p) => p.id === targetId);
    if (!targetPlayer) return;

    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket) return;

    console.log(`[Room ${roomId}] ${targetPlayer.name} was kicked by host`);

    // Tell the kicked player they've been removed
    targetSocket.emit("you_were_kicked", { reason: "You were kicked by the host." });

    // Remove from room
    removePlayerFromRoom(targetSocket, roomId, `${targetPlayer.name} was kicked`);
  });

  // ----------------------------------------------------------
  // start_vote_kick — any player can START a vote during a game.
  // Host vote immediately passes (counts as majority).
  // Payload: { targetId }
  // ----------------------------------------------------------
  socket.on("start_vote_kick", ({ targetId }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== "playing") return;

    // Can't vote to kick yourself
    if (targetId === socket.id) return;

    const targetPlayer = room.players.find((p) => p.id === targetId);
    if (!targetPlayer) return;

    // If host starts a vote kick, it's an instant kick (host power)
    if (socket.id === room.hostId) {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (!targetSocket) return;
      console.log(`[Room ${roomId}] Host instantly vote-kicked ${targetPlayer.name}`);
      targetSocket.emit("you_were_kicked", { reason: "You were removed by the host." });
      removePlayerFromRoom(targetSocket, roomId, `${targetPlayer.name} was removed by host`);
      return;
    }

    // If there's already an active vote, don't start another
    if (room.voteKick) {
      // Just add this person's vote to the existing one
      room.voteKick.votes.add(socket.id);
      checkVoteKickResult(roomId);
      return;
    }

    // Start a new vote-kick session
    room.voteKick = {
      targetId,
      targetName: targetPlayer.name,
      votes: new Set([socket.id]), // initiator auto-votes yes
      startedBy: socket.playerName,
    };

    console.log(`[Room ${roomId}] Vote-kick started against ${targetPlayer.name} by ${socket.playerName}`);

    // Broadcast to everyone so they see the vote prompt
    io.to(roomId).emit("vote_kick_started", {
      targetId,
      targetName: targetPlayer.name,
      startedBy: socket.playerName,
      voteCount: room.voteKick.votes.size,
      totalPlayers: room.players.length,
    });

    // Auto-expire vote after 15 seconds if not resolved
    room.voteKickTimeout = setTimeout(() => {
      if (rooms[roomId] && rooms[roomId].voteKick?.targetId === targetId) {
        io.to(roomId).emit("vote_kick_expired", { targetName: targetPlayer.name });
        rooms[roomId].voteKick = null;
        console.log(`[Room ${roomId}] Vote-kick against ${targetPlayer.name} expired`);
      }
    }, 15000);
  });

  // ----------------------------------------------------------
  // cast_vote_kick — a player clicks "Yes" on the vote popup.
  // Payload: { targetId }
  // ----------------------------------------------------------
  socket.on("cast_vote_kick", ({ targetId }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || !room.voteKick) return;
    if (room.voteKick.targetId !== targetId) return; // stale vote

    room.voteKick.votes.add(socket.id);

    io.to(roomId).emit("vote_kick_update", {
      targetId,
      targetName: room.voteKick.targetName,
      voteCount: room.voteKick.votes.size,
      totalPlayers: room.players.length,
    });

    checkVoteKickResult(roomId);
  });

  // ----------------------------------------------------------
  // toggle_visibility — HOST ONLY: flip public/private in lobby
  // Payload: { isPublic }
  // ----------------------------------------------------------
  socket.on("toggle_visibility", ({ isPublic }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameState !== "lobby") return;

    room.isPublic = isPublic;
    console.log(`[Room ${roomId}] Visibility changed to ${isPublic ? "public" : "private"}`);

    // Tell everyone in the room about the change
    io.to(roomId).emit("visibility_changed", { isPublic });
  });

  // ----------------------------------------------------------
  // word_chosen — drawer picks one of the 5 offered words
  // Payload: { word }
  // ----------------------------------------------------------
  socket.on("word_chosen", ({ word }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== "picking") return;

    const drawer = getCurrentDrawer(room);
    if (socket.id !== drawer.id) return; // only the drawer can pick

    // Validate that the word was actually in the offered list
    if (!room.wordChoices || !room.wordChoices.includes(word)) return;

    beginDrawing(roomId, word);
  });

  // ----------------------------------------------------------
  // draw_data — relay drawing strokes to room
  // Payload: { x0, y0, x1, y1, color, lineWidth }
  // ----------------------------------------------------------
  socket.on("draw_data", (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit("draw_data", data);
  });

  // ----------------------------------------------------------
  // clear_canvas — relay clear to room
  // ----------------------------------------------------------
  socket.on("clear_canvas", () => {
    if (socket.roomId) socket.to(socket.roomId).emit("clear_canvas");
  });

  // ----------------------------------------------------------
  // guess — player submits a word guess
  // Payload: { guess }
  // ----------------------------------------------------------
  socket.on("guess", ({ guess }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.gameState !== "playing") return;

    const drawer = getCurrentDrawer(room);
    if (socket.id === drawer.id) return;

    if (guess.trim().toLowerCase() === room.currentWord.trim().toLowerCase()) {
      const points = Math.max(50, Math.floor((room.timeLeft / room.roundDuration) * 200));
      const player = room.players.find((p) => p.id === socket.id);
      if (player) player.score += points;
      const drawerPlayer = room.players.find((p) => p.id === drawer.id);
      if (drawerPlayer) drawerPlayer.score += 30;

      io.to(roomId).emit("correct_guess", {
        guesserName: socket.playerName,
        points,
        players: room.players,
      });
      endRound(roomId, true);
    } else {
      io.to(roomId).emit("chat_message", {
        senderName: socket.playerName,
        message: guess,
      });
    }
  });

  // ----------------------------------------------------------
  // disconnect — browser tab closed or connection lost
  // ----------------------------------------------------------
  socket.on("disconnect", () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    removePlayerFromRoom(socket, roomId, `${socket.playerName} disconnected`);
  });
});

// ----------------------------------------------------------
// checkVoteKickResult — called after every new vote is cast.
// Kicks the target if strict majority (> 50%) have voted yes.
// ----------------------------------------------------------
function checkVoteKickResult(roomId) {
  const room = rooms[roomId];
  if (!room || !room.voteKick) return;

  const { targetId, targetName, votes } = room.voteKick;
  // Strict majority: more than half of OTHER players (excluding target)
  const eligibleVoters = room.players.filter((p) => p.id !== targetId).length;
  const needed = Math.ceil(eligibleVoters / 2);

  if (votes.size >= needed) {
    // Clear the vote kick timeout
    if (room.voteKickTimeout) { clearTimeout(room.voteKickTimeout); room.voteKickTimeout = null; }
    room.voteKick = null;

    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      console.log(`[Room ${roomId}] ${targetName} was vote-kicked (${votes.size}/${eligibleVoters} votes)`);
      targetSocket.emit("you_were_kicked", { reason: "You were vote-kicked by the players." });
      removePlayerFromRoom(targetSocket, roomId, `${targetName} was vote-kicked`);
    }
  }
}

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`✅ Skribbl backend running on http://localhost:${PORT}`);
});
