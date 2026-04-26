// ============================================================
// App.jsx — Root Component
// NEW FEATURES vs previous version:
//   - "Leave Room" back button in lobby (both host and guest)
//   - "Quit Game" button visible during game (top bar)
//   - Host kick panel in scoreboard (lobby + game)
//   - Vote-kick popup that appears when a vote is started
//   - Public/Private toggle slider in lobby settings (host only)
//     that instantly changes the room visibility via socket
//   - Notifications when someone is kicked / you are kicked
// ============================================================

import React, { useState, useEffect } from "react";
import socket from "./socket";
import Canvas from "./Canvas";
import Chat from "./Chat";
import "./App.css";

function App() {
  const [screen, setScreen] = useState("login");
  const [playerName, setPlayerName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [isPublic, setIsPublic] = useState(false); // live visibility state

  const [drawerId, setDrawerId] = useState("");
  const [drawerName, setDrawerName] = useState("");
  const [myWord, setMyWord] = useState("");
  const [wordChoices, setWordChoices] = useState([]); // NEW: 5 word options for drawer
  const [roundPicking, setRoundPicking] = useState(false); // NEW: word-pick phase active
  const [roundNumber, setRoundNumber] = useState(1);
  const [maxRounds, setMaxRounds] = useState(3);
  const [timeLeft, setTimeLeft] = useState(0);
  const [roundEndInfo, setRoundEndInfo] = useState(null);
  const [gameOverInfo, setGameOverInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentHint, setCurrentHint] = useState("");

  // Room settings (host controls)
  const [settingMaxPlayers, setSettingMaxPlayers] = useState(8);
  const [settingRounds, setSettingRounds] = useState(3);
  const [settingDuration, setSettingDuration] = useState(80);

  // Public room browser
  const [showPublicRooms, setShowPublicRooms] = useState(false);
  const [publicRoomsList, setPublicRoomsList] = useState([]);

  // Copy URL feedback
  const [urlCopied, setUrlCopied] = useState(false);

  // Join method tab: "code" | "url"
  const [joinMethod, setJoinMethod] = useState("code");

  // ---- NEW: Vote-kick state ----
  // When a vote starts, this holds { targetId, targetName, startedBy, voteCount, totalPlayers }
  const [voteKickInfo, setVoteKickInfo] = useState(null);
  const [myVoteCast, setMyVoteCast] = useState(false);

  // ---- NEW: Kicked notification ----
  const [kickedMsg, setKickedMsg] = useState("");

  // ---- NEW: Confirm quit dialog ----
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // On mount: check URL for ?room=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room");
    if (urlRoom) {
      setRoomIdInput(urlRoom.toUpperCase());
      setJoinMethod("code");
    }
  }, []);

  // ============================================================
  // SOCKET LISTENERS
  // ============================================================
  useEffect(() => {
    socket.on("room_created", ({ roomId, players, isPublic }) => {
      setRoomId(roomId);
      setPlayers(players);
      setIsHost(true);
      setIsPublic(isPublic);
      setScreen("lobby");
      window.history.replaceState({}, "", `?room=${roomId}`);
    });

    socket.on("room_joined", ({ roomId, players, isPublic }) => {
      setRoomId(roomId);
      setPlayers(players);
      setIsHost(false);
      setIsPublic(isPublic);
      setScreen("lobby");
      window.history.replaceState({}, "", `?room=${roomId}`);
    });

    socket.on("join_error", ({ message }) => setErrorMsg(message));
    socket.on("error_message", ({ message }) => setErrorMsg(message));

    socket.on("player_joined", ({ players }) => setPlayers(players));

    // player_left: update list + cancel any vote about the departed player
    socket.on("player_left", ({ players, reason }) => {
      setPlayers(players);
      // If the vote-kick target left, clear the popup
      setVoteKickInfo((prev) => {
        if (prev && !players.find((p) => p.id === prev.targetId)) return null;
        return prev;
      });
    });

    socket.on("you_are_host", () => setIsHost(true));

    // Visibility was toggled by host
    socket.on("visibility_changed", ({ isPublic }) => setIsPublic(isPublic));

    socket.on("public_rooms_list", ({ rooms }) => setPublicRoomsList(rooms));

    socket.on("round_picking", ({ drawerName, drawerId, roundNumber, maxRounds }) => {
      setDrawerName(drawerName);
      setDrawerId(drawerId);
      setRoundNumber(roundNumber);
      setMaxRounds(maxRounds);
      setMyWord("");
      setCurrentHint("");
      setRoundEndInfo(null);
      setGameOverInfo(null);
      setVoteKickInfo(null);
      setMyVoteCast(false);
      setWordChoices([]);
      setRoundPicking(true);
      setScreen("game");
    });

    socket.on("word_choices", ({ words }) => {
      setWordChoices(words);
    });

    socket.on("round_started", ({ drawerName, drawerId, roundNumber, maxRounds, timeLeft, hint }) => {
      setDrawerName(drawerName);
      setDrawerId(drawerId);
      setRoundNumber(roundNumber);
      setMaxRounds(maxRounds);
      setTimeLeft(timeLeft);
      setMyWord("");
      setCurrentHint(hint || "");
      setRoundEndInfo(null);
      setGameOverInfo(null);
      setVoteKickInfo(null);
      setMyVoteCast(false);
      setWordChoices([]);
      setRoundPicking(false);
      setScreen("game");
    });

    socket.on("your_word", ({ word }) => setMyWord(word));
    socket.on("timer_update", ({ timeLeft }) => setTimeLeft(timeLeft));
    socket.on("hint_update", ({ hint }) => setCurrentHint(hint));

    socket.on("round_ended", ({ word, players, wordWasGuessed }) => {
      setPlayers(players);
      setRoundEndInfo({ word, wordWasGuessed });
      setMyWord("");
      setCurrentHint("");
      setVoteKickInfo(null);
      setMyVoteCast(false);
    });

    socket.on("correct_guess", ({ players }) => setPlayers(players));
    socket.on("game_over", ({ players }) => setGameOverInfo({ players }));

    // ---- NEW: left_room — server confirmed our leave request ----
    socket.on("left_room", () => {
      // Clean up and go back to login
      window.history.replaceState({}, "", window.location.pathname);
      setScreen("login");
      setRoomId("");
      setPlayers([]);
      setIsHost(false);
      setDrawerId("");
      setMyWord("");
      setRoundEndInfo(null);
      setGameOverInfo(null);
      setVoteKickInfo(null);
      setShowQuitConfirm(false);
    });

    // ---- NEW: you_were_kicked — this client was removed ----
    socket.on("you_were_kicked", ({ reason }) => {
      window.history.replaceState({}, "", window.location.pathname);
      setKickedMsg(reason);
      setScreen("kicked");
    });

    // ---- NEW: vote_kick_started — show vote popup to everyone ----
    socket.on("vote_kick_started", (info) => {
      setVoteKickInfo(info);
      setMyVoteCast(false);
    });

    // ---- NEW: vote_kick_update — refresh vote count in popup ----
    socket.on("vote_kick_update", ({ targetId, targetName, voteCount, totalPlayers }) => {
      setVoteKickInfo((prev) =>
        prev ? { ...prev, voteCount, totalPlayers } : null
      );
    });

    // ---- NEW: vote_kick_expired — vote failed, close popup ----
    socket.on("vote_kick_expired", () => {
      setVoteKickInfo(null);
      setMyVoteCast(false);
    });

    return () => {
      [
        "room_created", "room_joined", "join_error", "error_message",
        "player_joined", "player_left", "you_are_host", "visibility_changed",
        "public_rooms_list", "round_picking", "word_choices",
        "round_started", "your_word", "timer_update",
        "hint_update", "round_ended", "correct_guess", "game_over",
        "left_room", "you_were_kicked",
        "vote_kick_started", "vote_kick_update", "vote_kick_expired",
      ].forEach((ev) => socket.off(ev));
    };
  }, []);

  // ============================================================
  // HANDLERS
  // ============================================================

  function handleCreateRoom() {
    if (!playerName.trim()) { setErrorMsg("Please enter your name first!"); return; }
    setErrorMsg("");
    socket.emit("create_room", { playerName: playerName.trim(), isPublic: false });
  }

  function handleJoinRoom() {
    if (!playerName.trim()) { setErrorMsg("Please enter your name first!"); return; }
    if (!roomIdInput.trim()) { setErrorMsg("Please enter a Room ID!"); return; }
    setErrorMsg("");
    socket.emit("join_room", {
      roomId: roomIdInput.trim().toUpperCase(),
      playerName: playerName.trim(),
    });
  }

  function handleJoinRandom() {
    if (!playerName.trim()) { setErrorMsg("Please enter your name first!"); return; }
    setErrorMsg("");
    socket.emit("join_random", { playerName: playerName.trim() });
  }

  function handleJoinFromBrowser(rid) {
    if (!playerName.trim()) { setErrorMsg("Please enter your name first!"); setShowPublicRooms(false); return; }
    setShowPublicRooms(false);
    socket.emit("join_room", { roomId: rid, playerName: playerName.trim() });
  }

  function handleOpenPublicRooms() {
    socket.emit("get_public_rooms");
    setShowPublicRooms(true);
  }

  function handleStartGame() {
    socket.emit("start_game", {
      maxPlayers: settingMaxPlayers,
      maxRounds: settingRounds,
      roundDuration: settingDuration,
    });
  }

  function handleCopyUrl() {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    });
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    });
  }

  // ---- NEW: Leave / Quit ----
  function handleLeaveRoom() {
    socket.emit("leave_room");
  }

  // Show confirm dialog before quitting mid-game
  function handleQuitGame() {
    setShowQuitConfirm(true);
  }

  function handleConfirmQuit() {
    socket.emit("leave_room");
  }

  // ---- NEW: Host kick from lobby or game ----
  function handleKickPlayer(targetId) {
    socket.emit("kick_player", { targetId });
  }

  // ---- NEW: Start vote-kick (non-host players during game) ----
  function handleStartVoteKick(targetId) {
    socket.emit("start_vote_kick", { targetId });
  }

  // ---- NEW: Cast vote in the vote-kick popup ----
  function handleCastVote() {
    if (!voteKickInfo || myVoteCast) return;
    socket.emit("cast_vote_kick", { targetId: voteKickInfo.targetId });
    setMyVoteCast(true);
  }

  // ---- NEW: Toggle visibility (host only, lobby only) ----
  function handleToggleVisibility(newIsPublic) {
    setIsPublic(newIsPublic);
    socket.emit("toggle_visibility", { isPublic: newIsPublic });
  }

  const iAmDrawer = socket.id === drawerId;
  const roomUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  // ============================================================
  // VOTE-KICK POPUP — rendered on top of game/lobby screens
  // ============================================================
  const VoteKickPopup = () => {
    if (!voteKickInfo) return null;
    const isTarget = voteKickInfo.targetId === socket.id;
    return (
      <div className="votekick-backdrop">
        <div className="votekick-card">
          <h3>🗳️ Vote Kick</h3>
          {isTarget ? (
            <p className="votekick-msg">
              Players are voting to kick <strong>you</strong>!
            </p>
          ) : (
            <p className="votekick-msg">
              <strong>{voteKickInfo.startedBy}</strong> started a vote to kick{" "}
              <strong>{voteKickInfo.targetName}</strong>
            </p>
          )}
          <div className="votekick-count">
            {voteKickInfo.voteCount} / {Math.ceil((voteKickInfo.totalPlayers - 1) / 2)} votes needed
          </div>
          {!isTarget && !isHost && (
            <button
              className={`votekick-yes-btn ${myVoteCast ? "voted" : ""}`}
              onClick={handleCastVote}
              disabled={myVoteCast}
            >
              {myVoteCast ? "✅ Voted!" : "👍 Vote Yes"}
            </button>
          )}
          {isHost && !isTarget && (
            <button
              className="votekick-host-btn"
              onClick={() => handleKickPlayer(voteKickInfo.targetId)}
            >
              ⚡ Kick Instantly (Host)
            </button>
          )}
          <p className="votekick-timer">Vote expires in 15 seconds</p>
        </div>
      </div>
    );
  };

  // ============================================================
  // QUIT CONFIRM DIALOG
  // ============================================================
  const QuitConfirmDialog = () => (
    <div className="votekick-backdrop">
      <div className="votekick-card">
        <h3>⚠️ Quit Game?</h3>
        <p className="votekick-msg">
          Are you sure you want to leave mid-game?
          {isHost && " As the host, another player will become the new host."}
        </p>
        <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
          <button className="quit-confirm-btn" onClick={handleConfirmQuit}>
            Yes, Leave
          </button>
          <button className="quit-cancel-btn" onClick={() => setShowQuitConfirm(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // ============================================================
  // BACKGROUND STICKERS — decorative floating shapes/emojis
  // Rendered on every screen for visual flair
  // ============================================================
  const BgStickers = () => (
    <div className="bg-stickers" aria-hidden="true">
      {/* Left column */}
      <span className="sticker s1">✏️</span>
      <span className="sticker s2">🎨</span>
      <span className="sticker s3">⭐</span>
      <span className="sticker s4">🖌️</span>
      <span className="sticker s5">💡</span>
      {/* Right column */}
      <span className="sticker s6">🎭</span>
      <span className="sticker s7">🌈</span>
      <span className="sticker s8">🎯</span>
      <span className="sticker s9">✨</span>
      <span className="sticker s10">🎪</span>
      {/* SVG shapes */}
      <svg className="sticker-shape shape-circle1" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,60,172,0.18)" strokeWidth="6"/>
      </svg>
      <svg className="sticker-shape shape-circle2" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,245,255,0.15)" strokeWidth="4" strokeDasharray="12 8"/>
      </svg>
      <svg className="sticker-shape shape-star" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="none" stroke="rgba(255,204,0,0.2)" strokeWidth="4"/>
      </svg>
      <svg className="sticker-shape shape-tri" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <polygon points="50,8 96,90 4,90" fill="none" stroke="rgba(0,245,255,0.12)" strokeWidth="4"/>
      </svg>
      <svg className="sticker-shape shape-squiggle" viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,30 Q25,5 50,30 Q75,55 100,30 Q125,5 150,30 Q175,55 200,30" fill="none" stroke="rgba(255,60,172,0.2)" strokeWidth="4" strokeLinecap="round"/>
      </svg>
      <svg className="sticker-shape shape-dots" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
        {[0,1,2,3,4].map(i => <circle key={i} cx={12 + i * 24} cy="20" r="6" fill="rgba(0,245,255,0.15)"/>)}
      </svg>
    </div>
  );

  // ============================================================
  // WORD CHOICE PICKER — overlay shown to the drawer before each round
  // ============================================================
  const WordChoicePicker = () => {
    if (!roundPicking) return null;

    // Drawer sees their 5 word options
    if (iAmDrawer && wordChoices.length > 0) {
      return (
        <div className="word-picker-backdrop">
          <div className="word-picker-card">
            <div className="word-picker-icon">🎨</div>
            <h2 className="word-picker-title">Choose Your Word!</h2>
            <p className="word-picker-sub">Pick one to draw. You have 15 seconds.</p>
            <div className="word-picker-options">
              {wordChoices.map((word) => (
                <button
                  key={word}
                  className="word-option-btn"
                  onClick={() => {
                    socket.emit("word_chosen", { word });
                    setWordChoices([]);
                    setRoundPicking(false);
                  }}
                >
                  {word}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Non-drawers see a waiting screen
    return (
      <div className="word-picker-backdrop">
        <div className="word-picker-card word-picker-waiting">
          <div className="word-picker-icon">⏳</div>
          <h2 className="word-picker-title">{drawerName} is picking a word...</h2>
          <p className="word-picker-sub">Get ready to guess!</p>
          <div className="picking-dots">
            <span/><span/><span/>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // SCREEN: Kicked
  // ============================================================
  if (screen === "kicked") {
    return (
      <div className="login-screen">
        <BgStickers />
        <div className="login-card" style={{ textAlign: "center", gap: "18px" }}>
          <div style={{ fontSize: "3rem" }}>🚫</div>
          <h2 className="logo" style={{ fontSize: "1.8rem" }}>You've been removed</h2>
          <p style={{ color: "var(--color-text-muted)", fontWeight: 600 }}>{kickedMsg}</p>
          <button className="btn-primary" onClick={() => {
            setKickedMsg("");
            setScreen("login");
            window.history.replaceState({}, "", window.location.pathname);
          }}>
            🏠 Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // SCREEN: Login
  // ============================================================
  if (screen === "login") {
    return (
      <div className="login-screen">
        <BgStickers />
        {/* Public rooms browser modal */}
        {showPublicRooms && (
          <div className="modal-backdrop" onClick={() => setShowPublicRooms(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>🌍 Public Rooms</h2>
                <button className="modal-close" onClick={() => setShowPublicRooms(false)}>✕</button>
              </div>
              {publicRoomsList.length === 0 ? (
                <p className="no-rooms-msg">No public rooms open right now.<br />Create one!</p>
              ) : (
                <ul className="public-rooms-list">
                  {publicRoomsList.map((r) => (
                    <li key={r.id} className="public-room-item">
                      <div className="pr-info">
                        <span className="pr-id">{r.id}</span>
                        <span className="pr-meta">
                          {r.playerCount}/{r.maxPlayers} players · {r.maxRounds} rounds · {r.roundDuration}s
                        </span>
                      </div>
                      <button className="btn-join-room" onClick={() => handleJoinFromBrowser(r.id)}>
                        Join
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="login-card">
          <h1 className="logo">✏️ Skribbl Clone</h1>
          <p className="tagline">Draw it. Guess it. Win it.</p>

          {errorMsg && <p className="error-msg">⚠️ {errorMsg}</p>}

          <input
            type="text"
            placeholder="Your name..."
            value={playerName}
            onChange={(e) => { setPlayerName(e.target.value); setErrorMsg(""); }}
            maxLength={20}
          />

          {/* CREATE section */}
          <div className="create-section">
            <button className="btn-primary" onClick={handleCreateRoom}>
              🎨 Create Room
            </button>
          </div>

          <div className="divider">— or join —</div>

          {/* JOIN method tabs */}
          <div className="join-tabs">
            <button
              className={`join-tab ${joinMethod === "code" ? "active" : ""}`}
              onClick={() => setJoinMethod("code")}
            >📋 Room Code</button>
            <button
              className={`join-tab ${joinMethod === "url" ? "active" : ""}`}
              onClick={() => setJoinMethod("url")}
            >🔗 Invite URL</button>
          </div>

          {joinMethod === "code" && (
            <div className="join-section">
              <input
                type="text"
                placeholder="Room ID (e.g. A3F9KZ)"
                value={roomIdInput}
                onChange={(e) => { setRoomIdInput(e.target.value.toUpperCase()); setErrorMsg(""); }}
                maxLength={6}
              />
              <button className="btn-secondary" onClick={handleJoinRoom}>
                🚪 Join Room
              </button>
            </div>
          )}

          {joinMethod === "url" && (
            <div className="join-section">
              <input
                type="text"
                placeholder="Paste invite URL..."
                onChange={(e) => {
                  const val = e.target.value;
                  const match = val.match(/[?&]room=([A-Z0-9]{6})/i);
                  if (match) setRoomIdInput(match[1].toUpperCase());
                  else setRoomIdInput(val.replace(/.*room=/, "").trim().toUpperCase().slice(0, 6));
                }}
              />
              <button className="btn-secondary" onClick={handleJoinRoom}>
                🔗 Join via URL
              </button>
            </div>
          )}

          <div className="bottom-actions">
            <button className="btn-random" onClick={handleJoinRandom}>
              🎲 Join Random
            </button>
            <button className="btn-browse" onClick={handleOpenPublicRooms}>
              🌍 Browse Rooms
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // SCREEN: Lobby
  // ============================================================
  if (screen === "lobby") {
    return (
      <div className="lobby-screen">
        <BgStickers />
        <div className="lobby-card">

          {/* Header row: title + Leave button */}
          <div className="lobby-header-row">
            <h2>🎮 Game Lobby</h2>
            {/* Back / Leave button — works for BOTH host and guest */}
            <button className="btn-leave" onClick={handleLeaveRoom} title="Leave room">
              🚪 Leave Room
            </button>
          </div>

          {/* Room code + URL */}
          <div className="room-id-display">
            <div className="room-code-row">
              <span>Code: <strong>{roomId}</strong></span>
              <button className="btn-copy-code" onClick={handleCopyCode}>
                {urlCopied ? "✅ Copied!" : "📋 Copy Code"}
              </button>
            </div>
            <div className="room-url-row">
              <span className="room-url-text">{roomUrl}</span>
              <button className="btn-copy-url" onClick={handleCopyUrl}>
                {urlCopied ? "✅" : "🔗 Copy Link"}
              </button>
            </div>
          </div>

          <h3 className="players-heading">
            Players ({players.length}{isHost ? `/${settingMaxPlayers}` : ""})
          </h3>

          {/* Player list — host sees a kick button next to each player */}
          <ul className="player-list">
            {players.map((p) => (
              <li key={p.id} className="player-item">
                <span className="player-item-name">
                  {p.id === socket.id ? "👤 " : "🙂 "}
                  {p.name}
                  {p.id === socket.id && " (You)"}
                  {p.id === players[0]?.id && " 👑"}
                </span>
                {/* Host can kick anyone except themselves */}
                {isHost && p.id !== socket.id && (
                  <button
                    className="btn-kick-small"
                    onClick={() => handleKickPlayer(p.id)}
                    title={`Kick ${p.name}`}
                  >
                    ✕ Kick
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Host settings section */}
          {isHost && (
            <div className="settings-section">
              <h4>⚙️ Room Settings</h4>
              <div className="settings-grid">
                <div className="setting-item">
                  <label>Max Players</label>
                  <select value={settingMaxPlayers} onChange={(e) => setSettingMaxPlayers(Number(e.target.value))}>
                    {[2,3,4,5,6,7,8,10,12].map(n => <option key={n} value={n}>{n} players</option>)}
                  </select>
                </div>
                <div className="setting-item">
                  <label>Rounds</label>
                  <select value={settingRounds} onChange={(e) => setSettingRounds(Number(e.target.value))}>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} round{n>1?"s":""}</option>)}
                  </select>
                </div>
                <div className="setting-item">
                  <label>Round Duration</label>
                  <select value={settingDuration} onChange={(e) => setSettingDuration(Number(e.target.value))}>
                    {[30,45,60,80,90,120,150,180].map(n => <option key={n} value={n}>{n}s</option>)}
                  </select>
                </div>

                {/* ---- NEW: Visibility Toggle Slider ---- */}
                <div className="setting-item">
                  <label>Visibility</label>
                  <div className="vis-toggle-row">
                    <span className={`vis-label ${!isPublic ? "active" : ""}`}>🔒 Private</span>
                    {/* Toggle: clicking the track flips the value */}
                    <div
                      className={`vis-slider-track ${isPublic ? "is-public" : "is-private"}`}
                      onClick={() => handleToggleVisibility(!isPublic)}
                      title="Toggle public/private"
                    >
                      <div className="vis-slider-thumb" />
                    </div>
                    <span className={`vis-label ${isPublic ? "active" : ""}`}>🌍 Public</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Non-host: show read-only room info */}
          {!isHost && (
            <div className="settings-section" style={{ opacity: 0.65 }}>
              <h4 style={{ color: "var(--color-text-muted)" }}>⚙️ Room Settings</h4>
              <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", fontWeight: 600 }}>
                {isPublic ? "🌍 Public room" : "🔒 Private room"} · Host controls settings.
              </p>
            </div>
          )}

          {isHost ? (
            <button className="btn-start" onClick={handleStartGame} disabled={players.length < 2}>
              {players.length < 2 ? "⏳ Waiting for players..." : "▶️ Start Game!"}
            </button>
          ) : (
            <p className="waiting-msg">⏳ Waiting for the host to start...</p>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // SCREEN: Game
  // ============================================================
  if (screen === "game") {
    return (
      <div className="game-layout">

        {/* Word choice picker — shown before each round */}
        <WordChoicePicker />

        {/* Vote-kick popup — floats above everything */}
        <VoteKickPopup />

        {/* Quit confirm dialog */}
        {showQuitConfirm && <QuitConfirmDialog />}

        {/* TOP BAR */}
        <div className="game-topbar panel" style={{ gridColumn: "1 / -1" }}>
          <span className="round-info">Round {roundNumber} / {maxRounds}</span>

          <div className="word-area">
            {roundPicking ? (
              <span className="word-display" style={{ color: "var(--color-accent3)" }}>
                🤔 {iAmDrawer ? "Choose your word!" : `${drawerName} is picking...`}
              </span>
            ) : iAmDrawer ? (
              <span className="word-display">🎨 Your word: <em>"{myWord}"</em></span>
            ) : (
              <div className="hint-display">
                <span className="hint-label">🖊️ {drawerName} is drawing</span>
                <span className="hint-letters">{currentHint}</span>
              </div>
            )}
          </div>

          <div className="topbar-right">
            <span className={`timer ${timeLeft <= 10 ? "timer-urgent" : ""}`}>
              ⏱ {timeLeft}s
            </span>
            {/* ---- NEW: Quit button ---- */}
            <button className="btn-quit-game" onClick={handleQuitGame} title="Leave game">
              🚪 Quit
            </button>
          </div>
        </div>

        {/* LEFT: Scoreboard + kick/vote-kick buttons */}
        <div className="panel scoreboard">
          <h3>Scoreboard</h3>
          <ul className="score-list">
            {[...players].sort((a, b) => b.score - a.score).map((p) => (
              <li key={p.id} className={`score-item ${p.id === drawerId ? "is-drawer" : ""}`}>
                <div className="score-info">
                  <span className="score-name">
                    {p.id === drawerId ? "🎨 " : ""}
                    {p.name}
                    {p.id === socket.id ? " (You)" : ""}
                  </span>
                  <span className="score-points">{p.score}pt</span>
                </div>
                {/* Host gets direct kick button; others get vote-kick */}
                {p.id !== socket.id && (
                  <div className="score-actions">
                    {isHost ? (
                      <button
                        className="btn-kick-small"
                        onClick={() => handleKickPlayer(p.id)}
                        title={`Kick ${p.name}`}
                      >✕</button>
                    ) : (
                      <button
                        className="btn-votekick-small"
                        onClick={() => handleStartVoteKick(p.id)}
                        title={`Vote to kick ${p.name}`}
                      >🗳️</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* CENTER: Canvas + overlays */}
        <div className="canvas-area">
          <Canvas iAmDrawer={iAmDrawer} />

          {roundEndInfo && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>{roundEndInfo.wordWasGuessed ? "🎉 Correct!" : "⏰ Time's Up!"}</h2>
                <p>The word was: <strong>{roundEndInfo.word}</strong></p>
              </div>
            </div>
          )}

          {gameOverInfo && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>🏆 Game Over!</h2>
                <ol className="final-scores">
                  {gameOverInfo.players.map((p, i) => (
                    <li key={p.id}>
                      {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "   "}
                      {p.name} — {p.score}pt
                    </li>
                  ))}
                </ol>
                <button className="btn-primary" onClick={() => {
                  window.history.replaceState({}, "", window.location.pathname);
                  window.location.reload();
                }}>
                  🔄 Play Again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Chat */}
        <Chat iAmDrawer={iAmDrawer} drawerId={drawerId} players={players} mySocketId={socket.id} />
      </div>
    );
  }

  return null;
}

export default App;
