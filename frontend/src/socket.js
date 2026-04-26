// ============================================================
// socket.js — Creates and exports a single Socket.IO client instance.
//
// WHY a separate file?
// If we called `io("http://localhost:3001")` in multiple components,
// we'd create multiple connections. By creating it ONCE here and
// importing it everywhere, all components share the same connection.
// ============================================================

import { io } from "socket.io-client";

// Connect to our backend server
// During development, the backend runs on port 3001
const socket = io("http://localhost:3001");

export default socket;
