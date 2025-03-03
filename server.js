const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // Store players globally

// Function to broadcast player updates
function broadcastPlayers() {
    const payload = JSON.stringify({ type: "updatePlayers", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on("connection", (ws) => {
    console.log("New client connected.");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`Player joined: ${data.name}`);
                
                // Prevent duplicate players
                if (!players.some(player => player.name === data.name)) {
                    players.push({ name: data.name, chips: 1000, ws });
                    broadcastPlayers(); // Send update to all clients
                }
            }

            if (data.type === "move") {
                console.log(`Player ${data.name} made a move: ${data.move} ${data.amount}`);
            }

        } catch (error) {
            console.error("Invalid message format:", message);
        }
    });

    ws.on("close", () => {
        console.log("A player disconnected.");
        
        // Remove disconnected player
        players = players.filter(player => player.ws !== ws);
        broadcastPlayers(); // Update all clients
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));
