// ============================================================
// Canvas.jsx — The Drawing Board
// Fixed: canvas pointer uses scale factor for correct coords
// Added: eraser tool, touch support
// ============================================================

import React, { useRef, useEffect, useState } from "react";
import socket from "./socket";
import "./Canvas.css";

function Canvas({ iAmDrawer }) {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [selectedColor, setSelectedColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(4);
  const [isEraser, setIsEraser] = useState(false);

  const colors = [
    "#ffffff", "#000000", "#e74c3c", "#e67e22",
    "#f1c40f", "#2ecc71", "#3498db", "#9b59b6",
    "#1abc9c", "#e91e63", "#ff6b35", "#607d8b",
  ];

  // THE KEY FIX: scale mouse position by canvas internal vs CSS display size
  function getCanvasPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function getTouchPos(e) {
    const touch = e.touches[0] || e.changedTouches[0];
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY,
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    socket.on("draw_data", (data) => {
      drawLine(ctx, data.x0, data.y0, data.x1, data.y1, data.color, data.lineWidth);
    });

    socket.on("clear_canvas", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    return () => {
      socket.off("draw_data");
      socket.off("clear_canvas");
    };
  }, []);

  function drawLine(ctx, x0, y0, x1, y1, color, width) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function handleMouseDown(e) {
    if (!iAmDrawer) return;
    isDrawing.current = true;
    lastPos.current = getCanvasPos(e);
  }

  function handleMouseMove(e) {
    if (!iAmDrawer || !isDrawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getCanvasPos(e);
    const color = isEraser ? "#ffffff" : selectedColor;
    const width = isEraser ? lineWidth * 3 : lineWidth;

    drawLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y, color, width);
    socket.emit("draw_data", {
      x0: lastPos.current.x, y0: lastPos.current.y,
      x1: pos.x, y1: pos.y,
      color, lineWidth: width,
    });
    lastPos.current = pos;
  }

  function handleMouseUp() { isDrawing.current = false; }
  function handleMouseLeave() { isDrawing.current = false; }

  function handleTouchStart(e) {
    if (!iAmDrawer) return;
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getTouchPos(e);
  }

  function handleTouchMove(e) {
    if (!iAmDrawer || !isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getTouchPos(e);
    const color = isEraser ? "#ffffff" : selectedColor;
    const width = isEraser ? lineWidth * 3 : lineWidth;

    drawLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y, color, width);
    socket.emit("draw_data", {
      x0: lastPos.current.x, y0: lastPos.current.y,
      x1: pos.x, y1: pos.y,
      color, lineWidth: width,
    });
    lastPos.current = pos;
  }

  function handleTouchEnd() { isDrawing.current = false; }

  function handleClearCanvas() {
    if (!iAmDrawer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("clear_canvas");
  }

  return (
    <div className="canvas-container">
      <canvas
        ref={canvasRef}
        width={700}
        height={500}
        className={`drawing-canvas ${iAmDrawer ? "can-draw" : ""}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {iAmDrawer && (
        <div className="drawing-toolbar">
          <div className="color-palette">
            {colors.map((color) => (
              <button
                key={color}
                className={`color-swatch ${!isEraser && selectedColor === color ? "selected" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => { setSelectedColor(color); setIsEraser(false); }}
                title={color}
              />
            ))}
          </div>

          <button
            className={`eraser-btn ${isEraser ? "selected" : ""}`}
            onClick={() => setIsEraser(!isEraser)}
          >
            🧹 Erase
          </button>

          <div className="brush-sizes">
            {[2, 4, 8, 16].map((size) => (
              <button
                key={size}
                className={`brush-btn ${lineWidth === size ? "selected" : ""}`}
                onClick={() => setLineWidth(size)}
              >
                <span
                  className="brush-preview"
                  style={{
                    width: size + 4,
                    height: size + 4,
                    backgroundColor: isEraser ? "#aaa" : selectedColor,
                  }}
                />
              </button>
            ))}
          </div>

          <button className="clear-btn" onClick={handleClearCanvas}>
            🗑️ Clear
          </button>
        </div>
      )}

      {!iAmDrawer && (
        <div className="viewer-hint">
          👀 You are guessing — type your answer in the chat!
        </div>
      )}
    </div>
  );
}

export default Canvas;
