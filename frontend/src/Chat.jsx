// ============================================================
// Chat.jsx — The Guessing & Chat Panel
//
// This component handles:
// 1. Displaying a scrollable list of messages (guesses + notifications)
// 2. An input field for guessers to type their guesses
// 3. Listening for incoming chat and correct_guess events
//
// PROPS:
//   iAmDrawer  (bool)   — drawers can't guess their own word
//   drawerId   (string) — socket ID of the current drawer
//   players    (array)  — player list (to show names)
//   mySocketId (string) — this user's socket ID
// ============================================================

import React, { useState, useEffect, useRef } from "react";
import socket from "./socket";
import "./Chat.css";

function Chat({ iAmDrawer, drawerId, players, mySocketId }) {
  // Array of message objects: { id, type, senderName, text }
  // type can be: "chat" | "correct" | "system"
  const [messages, setMessages] = useState([]);

  // The current value of the guess input field
  const [guessInput, setGuessInput] = useState("");

  // A ref to the bottom of the messages list so we can auto-scroll
  const messagesEndRef = useRef(null);

  // ----------------------------------------------------------
  // Auto-scroll to the bottom whenever a new message arrives
  // ----------------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ----------------------------------------------------------
  // useEffect: Register Socket.IO listeners for chat events
  // ----------------------------------------------------------
  useEffect(() => {
    // --- chat_message: A wrong guess or system message ---
    // The server emits this when someone guesses wrong
    socket.on("chat_message", ({ senderName, message }) => {
      addMessage("chat", senderName, message);
    });

    // --- correct_guess: Someone guessed the word right! ---
    socket.on("correct_guess", ({ guesserName, points }) => {
      addMessage("correct", "🎉 System", `${guesserName} guessed correctly! +${points} pts`);
    });

    // --- round_ended: Announce the word at round end ---
    socket.on("round_ended", ({ word, wordWasGuessed }) => {
      if (!wordWasGuessed) {
        addMessage("system", "System", `Time's up! The word was: "${word}"`);
      }
    });

    return () => {
      socket.off("chat_message");
      socket.off("correct_guess");
      socket.off("round_ended");
    };
  }, []);

  // ----------------------------------------------------------
  // addMessage — Helper to append a new message to state.
  // We use a functional update (prev => ...) to avoid stale closures.
  // ----------------------------------------------------------
  function addMessage(type, senderName, text) {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(), // simple unique key
        type,
        senderName,
        text,
      },
    ]);
  }

  // ----------------------------------------------------------
  // handleSendGuess — Called when the user presses Enter or
  // clicks the Send button.
  // ----------------------------------------------------------
  function handleSendGuess() {
    const trimmed = guessInput.trim();
    if (!trimmed) return; // Don't send empty guesses

    // Emit the guess to the server
    // Server will check if it's correct and respond accordingly
    socket.emit("guess", { guess: trimmed });

    // Clear the input field
    setGuessInput("");
  }

  // Allow pressing Enter to submit
  function handleKeyDown(e) {
    if (e.key === "Enter") {
      handleSendGuess();
    }
  }

  return (
    <div className="chat-panel panel">
      <h3 className="chat-title">💬 Chat & Guesses</h3>

      {/* Scrollable message list */}
      <div className="messages-list">
        {messages.length === 0 && (
          <p className="no-messages">No messages yet. Start guessing!</p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.type}`}>
            <span className="message-sender">{msg.senderName}:</span>{" "}
            <span className="message-text">{msg.text}</span>
          </div>
        ))}

        {/* Invisible div at the bottom — we scroll to this */}
        <div ref={messagesEndRef} />
      </div>

      {/* Guess input — disabled if you're the drawer */}
      <div className="guess-input-area">
        <input
          type="text"
          placeholder={iAmDrawer ? "You are drawing..." : "Type your guess..."}
          value={guessInput}
          onChange={(e) => setGuessInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={iAmDrawer} // Drawer can't type guesses
          maxLength={50}
        />
        <button
          className="send-btn"
          onClick={handleSendGuess}
          disabled={iAmDrawer}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

export default Chat;
