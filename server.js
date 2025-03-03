const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];

wss.on("connection", (ws) => {
    console.log("🟢 New player connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            console.log("📩 Received message from client:", data);

            if (data.type === "join") {
                const newPlayer = { id: Date.now(), name: data.name, chips: 1000 };
                players.push(newPlayer);
                console.log("👥 Updated players list:", players);

                broadcast({ type: "updatePlayers", players });
            }
        } catch (error) {
            console.error("❌ Error parsing message:", error);
        }
    });

    ws.on("close", () => {
        console.log("🔴 A player disconnected");
    });
});

// Function to send updates to all connected clients
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
