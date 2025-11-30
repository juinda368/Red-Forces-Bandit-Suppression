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

// 获取公开房间列表（包括进行中的游戏，供观战）
function getPublicRooms() {
    const list = [];
    rooms.forEach((room, id) => {
        const canJoin = room.players.length < 2;
        const isPlaying = room.gameState && !room.gameState.gameOver;
        list.push({
            id,
            playerCount: room.players.length,
            spectatorCount: room.spectators ? room.spectators.length : 0,
            faction: room.players[0]?.faction,
            canJoin,
            isPlaying
        });
    });
    return list;
}

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);
    
    // 获取房间列表
    socket.on('getRoomList', () => {
        socket.emit('roomList', getPublicRooms());
    });
    
    // 创建房间
    socket.on('createRoom', ({ faction, customRoomId }) => {
        let roomId = customRoomId ? customRoomId.toUpperCase() : generateRoomId();
        
        // 检查房间是否已存在
        if (rooms.has(roomId)) {
            socket.emit('error', '房间号已存在，请换一个');
            return;
        }
        
        rooms.set(roomId, {
            id: roomId,
            players: [{ id: socket.id, faction, ready: false }],
            spectators: [],
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
        socket.isSpectator = false;
        
        socket.emit('roomJoined', { roomId, faction });
        io.to(roomId).emit('playerJoined', { players: room.players });
        // 通知观众玩家数量变化
        io.to(roomId).emit('spectatorUpdate', { count: room.spectators.length });
        console.log(`玩家加入房间 ${roomId}，${faction} 方`);
    });
    
    // 观战房间
    socket.on('spectateRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', '房间不存在');
            return;
        }
        
        room.spectators.push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.isSpectator = true;
        
        socket.emit('spectateJoined', {
            roomId,
            gameState: room.gameState,
            players: room.players,
            spectatorCount: room.spectators.length
        });
        io.to(roomId).emit('spectatorUpdate', { count: room.spectators.length });
        console.log(`观众加入房间 ${roomId}`);
    });
    
    // 观众发送表情
    socket.on('spectatorEmoji', (emoji) => {
        if (!socket.isSpectator) return;
        io.to(socket.roomId).emit('spectatorEmojiReceived', { emoji });
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
    
    // 选中棋子 - 转发给对方
    socket.on('pieceSelected', (data) => {
        socket.to(socket.roomId).emit('opponentPieceSelected', data);
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
        
        // 只能悔自己的棋：当前回合是对方的，说明上一步是自己走的
        if (room.gameState && room.gameState.turn === socket.faction) {
            socket.emit('undoRejected', '只能悔自己的棋');
            return;
        }
        
        room.undoRequest = socket.id;
        socket.to(socket.roomId).emit('undoRequested', socket.faction);
    });
    
    // 响应悔棋请求
    socket.on('respondUndo', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.undoRequest) return;
        
        const requesterId = room.undoRequest;
        if (accepted && room.history.length > 0) {
            room.gameState = room.history.pop();
            io.to(socket.roomId).emit('undoAccepted', room.gameState);
        } else {
            // 只通知请求方被拒绝
            io.to(requesterId).emit('undoRejected', '对方拒绝悔棋');
            // 通知拒绝方已拒绝
            socket.emit('undoRejectedByMe');
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
    
    // 请求求和
    socket.on('requestDraw', () => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameState || room.gameState.gameOver) return;
        
        room.drawRequest = socket.id;
        socket.to(socket.roomId).emit('drawRequested', socket.faction);
    });
    
    // 响应求和
    socket.on('respondDraw', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.drawRequest) return;
        
        const requesterId = room.drawRequest;
        if (accepted) {
            room.gameState.gameOver = true;
            room.gameState.winner = 'draw';
            io.to(socket.roomId).emit('gameUpdate', room.gameState);
            io.to(socket.roomId).emit('gameOver', 'draw');
        } else {
            io.to(requesterId).emit('drawRejected');
            socket.emit('drawRejectedByMe');
        }
        room.drawRequest = null;
    });
    
    // 请求再来一局
    socket.on('requestRematch', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        room.rematchRequest = socket.id;
        socket.to(socket.roomId).emit('rematchRequested', socket.faction);
    });
    
    // 响应再来一局
    socket.on('respondRematch', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.rematchRequest) return;
        
        if (accepted) {
            // 保持原阵营，重置准备状态
            room.players.forEach(p => p.ready = false);
            room.gameState = null;
            room.history = [];
            // 分别通知请求方和响应方
            const requesterId = room.rematchRequest;
            io.to(socket.roomId).emit('rematchAccepted', { requesterId });
        } else {
            io.to(room.rematchRequest).emit('rematchRejected');
        }
        room.rematchRequest = null;
    });
    
    // 请求交换阵营
    socket.on('requestSwapFaction', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        room.swapRequest = socket.id;
        socket.to(socket.roomId).emit('swapRequested', socket.faction);
    });
    
    // 响应交换阵营
    socket.on('respondSwap', (accepted) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.swapRequest) return;
        
        const requesterId = room.swapRequest;
        if (accepted) {
            // 交换双方阵营
            room.players.forEach(p => {
                p.faction = p.faction === 'red' ? 'bandit' : 'red';
                p.ready = false;
            });
            // 更新所有socket的faction
            const sockets = io.sockets.adapter.rooms.get(socket.roomId);
            if (sockets) {
                sockets.forEach(socketId => {
                    const s = io.sockets.sockets.get(socketId);
                    if (s) {
                        s.faction = s.faction === 'red' ? 'bandit' : 'red';
                    }
                });
            }
            io.to(socket.roomId).emit('swapAccepted');
        } else {
            io.to(requesterId).emit('swapRejected');
            socket.emit('swapRejectedByMe');
        }
        room.swapRequest = null;
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
        if (socket.isSpectator) {
            room.spectators = room.spectators.filter(id => id !== socket.id);
            io.to(socket.roomId).emit('spectatorUpdate', { count: room.spectators.length });
        } else {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0 && room.spectators.length === 0) {
                rooms.delete(socket.roomId);
            } else if (room.players.length === 0) {
                // 玩家都走了，踢出观众
                room.spectators.forEach(specId => {
                    const specSocket = io.sockets.sockets.get(specId);
                    if (specSocket) {
                        specSocket.emit('roomClosed');
                        specSocket.leave(socket.roomId);
                        specSocket.roomId = null;
                    }
                });
                rooms.delete(socket.roomId);
            } else {
                io.to(socket.roomId).emit('opponentLeft');
            }
        }
    }
    socket.leave(socket.roomId);
    socket.roomId = null;
    socket.isSpectator = false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
