const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 房间数据
const rooms = new Map();

// 生成房间号
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);
    
    // 创建房间
    socket.on('createRoom', (faction) => {
        const roomId = generateRoomId();
        rooms.set(roomId, {
            id: roomId,
            players: [{ id: socket.id, faction, ready: false }],
            gameState: null,
            history: [],
            undoRequest: null
        });
        socket.join(roomId);
        socket.roomId = roomId;
        socket.faction = faction;
        socket.emit('roomCreated', { roomId, faction });
        console.log(`房间 ${roomId} 创建，${faction} 方`);
    });
    
    // 加入房间
    socket.on('joinRoom', ({ roomId, faction }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', '房间不存在');
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('error', '房间已满');
            return;
        }
        const existingFaction = room.players[0].faction;
        if (faction === existingFaction) {
            socket.emit('error', `${faction}方已被选择，请选择另一阵营`);
            return;
        }
        
        room.players.push({ id: socket.id, faction, ready: false });
        socket.join(roomId);
        socket.roomId = roomId;
        socket.faction = faction;
        
        socket.emit('roomJoined', { roomId, faction });
        io.to(roomId).emit('playerJoined', { players: room.players });
        console.log(`玩家加入房间 ${roomId}，${faction} 方`);
    });
    
    // 玩家准备/选择布局完成
    socket.on('playerReady', (redPositions) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = true;
            if (player.faction === 'red') {
                room.redPositions = redPositions;
            }
        }
        
        // 检查是否都准备好
        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            const initialState = {
                redPositions: room.redPositions || [20, 22, 24],
                bandits: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14],
                turn: 'red',
                gameOver: false,
                winner: null
            };
            room.gameState = initialState;
            room.history = [];
            io.to(socket.roomId).emit('gameStart', initialState);
        } else {
            io.to(socket.roomId).emit('waitingOpponent');
        }
    });
    
    // 移动棋子
    socket.on('makeMove', (moveData) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameState) return;
        
        // 验证是否轮到该玩家
        if (room.gameState.turn !== socket.faction) return;
        
        // 保存历史
        room.history.push(JSON.parse(JSON.stringify(room.gameState)));
        
        // 更新状态
        const { pieceIndex, target, captured } = moveData;
        if (socket.faction === 'red') {
            room.gameState.redPositions[pieceIndex] = target;
            if (captured !== null) {
                room.gameState.bandits = room.gameState.bandits.filter(p => p !== captured);
            }
            room.gameState.turn = 'bandit';
        } else {
            room.gameState.bandits[pieceIndex] = target;
            room.gameState.turn = 'red';
        }
        
        // 检查胜负
        if (room.gameState.bandits.length === 0) {
            room.gameState.gameOver = true;
            room.gameState.winner = 'red';
        }
        
        io.to(socket.roomId).emit('gameUpdate', room.gameState);
        
        if (room.gameState.gameOver) {
            io.to(socket.roomId).emit('gameOver', room.gameState.winner);
        }
    });

    
    // 红军无路可走
    socket.on('redTrapped', () => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameState) return;
        
        room.gameState.gameOver = true;
        room.gameState.winner = 'bandit';
        io.to(socket.roomId).emit('gameUpdate', room.gameState);
        io.to(socket.roomId).emit('gameOver', 'bandit');
    });
    
    // 请求悔棋
    socket.on('requestUndo', () => {
        const room = rooms.get(socket.roomId);
        if (!room || room.history.length === 0) {
            socket.emit('undoRejected', '没有可悔棋的步骤');
            return;
        }
        
        room.undoRequest = socket.id;
        socket.to(socket.roomId).emit('undoRequested', socket.faction);
    });
    
    // 响应悔棋请求
    socket.on('respondUndo', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.undoRequest) return;
        
        if (accepted && room.history.length > 0) {
            room.gameState = room.history.pop();
            io.to(socket.roomId).emit('undoAccepted', room.gameState);
        } else {
            io.to(socket.roomId).emit('undoRejected', '对方拒绝悔棋');
        }
        room.undoRequest = null;
    });
    
    // 聊天消息
    socket.on('chatMessage', (message) => {
        io.to(socket.roomId).emit('chatMessage', {
            faction: socket.faction,
            message,
            time: new Date().toLocaleTimeString()
        });
    });
    
    // 发送表情
    socket.on('sendEmoji', (emoji) => {
        io.to(socket.roomId).emit('emojiReceived', {
            faction: socket.faction,
            emoji
        });
    });
    
    // 重新开始
    socket.on('requestRestart', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        room.restartRequest = socket.id;
        socket.to(socket.roomId).emit('restartRequested', socket.faction);
    });
    
    // 响应重新开始
    socket.on('respondRestart', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        if (accepted) {
            // 重置房间状态，让玩家重新选择阵营
            room.players.forEach(p => {
                p.ready = false;
                p.faction = null;
            });
            room.gameState = null;
            room.history = [];
            io.to(socket.roomId).emit('restartAccepted');
        } else {
            io.to(socket.roomId).emit('restartRejected');
        }
        room.restartRequest = null;
    });
    
    // 离开房间
    socket.on('leaveRoom', () => {
        handleLeave(socket);
    });
    
    // 断开连接
    socket.on('disconnect', () => {
        handleLeave(socket);
        console.log('用户断开:', socket.id);
    });
});

function handleLeave(socket) {
    if (!socket.roomId) return;
    
    const room = rooms.get(socket.roomId);
    if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
            rooms.delete(socket.roomId);
        } else {
            io.to(socket.roomId).emit('opponentLeft');
        }
    }
    socket.leave(socket.roomId);
    socket.roomId = null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
