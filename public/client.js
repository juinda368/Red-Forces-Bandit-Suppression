// 红军土匪棋 - 联机客户端
const socket = io();

// 游戏常量
const GRID_SIZE = 60;
const OFFSET = 40;
const POINTS = 5;

// 状态
let myFaction = null;
let roomId = null;
let selectedFaction = null;
let gameState = null;
let selectedPiece = null;
let validMoves = [];
let setupPositions = [];
const connections = [];

// 初始化连接关系
function initConnections() {
    for (let y = 0; y < POINTS; y++) {
        for (let x = 0; x < POINTS - 1; x++) {
            connections.push([y * POINTS + x, y * POINTS + x + 1]);
        }
    }
    for (let x = 0; x < POINTS; x++) {
        for (let y = 0; y < POINTS - 1; y++) {
            connections.push([y * POINTS + x, (y + 1) * POINTS + x]);
        }
    }
}

// UI 切换
function showScreen(screenId) {
    document.querySelectorAll('#lobbyScreen, #gameScreen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

function showPanel(panelId) {
    document.querySelectorAll('#mainMenu, #createRoomPanel, #joinRoomPanel, #waitingPanel')
        .forEach(el => el.classList.add('hidden'));
    document.getElementById(panelId).classList.remove('hidden');
}

function showOverlay(id) { document.getElementById(id).classList.add('show'); }
function hideOverlay(id) { document.getElementById(id).classList.remove('show'); }

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// 大厅操作
function showCreateRoom() { showPanel('createRoomPanel'); selectedFaction = null; updateFactionUI(); }
function showJoinRoom() { showPanel('joinRoomPanel'); selectedFaction = null; updateFactionUI(); }
function backToMenu() { showPanel('mainMenu'); }

function selectFaction(faction) {
    selectedFaction = faction;
    updateFactionUI();
}

function updateFactionUI() {
    document.querySelectorAll('.faction-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.faction === selectedFaction);
    });
    const createBtn = document.getElementById('createBtn');
    const joinBtn = document.getElementById('joinBtn');
    if (createBtn) createBtn.disabled = !selectedFaction;
    if (joinBtn) joinBtn.disabled = !selectedFaction || !document.getElementById('roomIdInput').value;
}

document.getElementById('roomIdInput')?.addEventListener('input', updateFactionUI);


function createRoom() {
    if (!selectedFaction) return;
    const customRoomId = document.getElementById('customRoomId')?.value.trim();
    socket.emit('createRoom', { faction: selectedFaction, customRoomId });
}

function joinRoom() {
    const inputRoomId = document.getElementById('roomIdInput').value.toUpperCase();
    if (!inputRoomId || !selectedFaction) return;
    socket.emit('joinRoom', { roomId: inputRoomId, faction: selectedFaction });
}

function leaveRoom() {
    socket.emit('leaveRoom');
    roomId = null;
    myFaction = null;
    gameState = null;
    hideOverlay('victoryOverlay');
    hideOverlay('setupPanel');
    showScreen('lobbyScreen');
    showPanel('mainMenu');
}

// Socket 事件
socket.on('roomCreated', (data) => {
    roomId = data.roomId;
    myFaction = data.faction;
    document.getElementById('displayRoomId').textContent = roomId;
    showPanel('waitingPanel');
});

socket.on('roomJoined', (data) => {
    roomId = data.roomId;
    myFaction = data.faction;
    enterGame();
});

socket.on('playerJoined', (data) => {
    if (data.players.length === 2) {
        enterGame();
    }
});

socket.on('error', (msg) => {
    showToast(msg);
});

socket.on('opponentLeft', () => {
    showToast('对手已离开房间');
    hideOverlay('victoryOverlay');
    gameState = null;
    renderPieces();
    document.getElementById('status').textContent = '对手已离开';
});

function enterGame() {
    showScreen('gameScreen');
    document.getElementById('gameRoomId').textContent = roomId;
    const factionDisplay = document.getElementById('myFactionDisplay');
    factionDisplay.textContent = myFaction === 'red' ? '⭐ 红军方' : '💀 土匪方';
    factionDisplay.className = 'my-faction ' + myFaction;
    
    initConnections();
    drawBoard();
    
    // 红军方选择布局
    if (myFaction === 'red') {
        setupPositions = [];
        updateSetupUI();
        showOverlay('setupPanel');
    } else {
        // 土匪方等待
        socket.emit('playerReady', null);
        document.getElementById('status').textContent = '等待红军布阵...';
    }
}

// 布局选择
function updateSetupUI() {
    document.querySelectorAll('.setup-pos').forEach(pos => {
        const posId = parseInt(pos.dataset.pos);
        if (setupPositions.includes(posId)) {
            pos.classList.add('selected');
            pos.textContent = '红';
        } else {
            pos.classList.remove('selected');
            pos.textContent = (posId - 19).toString();
        }
    });
    document.getElementById('setupHint').textContent = `已选: ${setupPositions.length}/3`;
    document.getElementById('confirmSetupBtn').disabled = setupPositions.length !== 3;
}

document.querySelectorAll('.setup-pos').forEach(pos => {
    pos.addEventListener('click', () => {
        const posId = parseInt(pos.dataset.pos);
        const index = setupPositions.indexOf(posId);
        if (index > -1) {
            setupPositions.splice(index, 1);
        } else if (setupPositions.length < 3) {
            setupPositions.push(posId);
        }
        updateSetupUI();
    });
});

function useDefaultSetup() {
    // 选中1、3、5位置（20, 22, 24）
    setupPositions = [20, 22, 24];
    updateSetupUI();
}

function confirmSetup() {
    if (setupPositions.length !== 3) return;
    hideOverlay('setupPanel');
    socket.emit('playerReady', [...setupPositions].sort((a, b) => a - b));
    document.getElementById('status').textContent = '等待对手...';
}

socket.on('waitingOpponent', () => {
    document.getElementById('status').textContent = '等待对手准备...';
});


// 游戏开始
socket.on('gameStart', (state) => {
    gameState = state;
    selectedPiece = null;
    validMoves = [];
    updateStatus();
    renderPieces();
    addChatMessage('system', '游戏开始！');
});

socket.on('gameUpdate', (state) => {
    gameState = state;
    selectedPiece = null;
    validMoves = [];
    updateStatus();
    renderPieces();
    
    // 检查红军是否被困
    if (gameState.turn === 'red' && myFaction === 'red' && !canRedMove()) {
        socket.emit('redTrapped');
    }
});

socket.on('gameOver', (winner) => {
    const icon = document.getElementById('victoryIcon');
    const title = document.getElementById('victoryTitle');
    const sub = document.getElementById('victorySub');
    
    if (winner === 'draw') {
        icon.textContent = '🤝';
        title.textContent = '和棋！';
        title.className = 'victory-title';
        sub.textContent = '双方握手言和';
    } else if (winner === 'red') {
        icon.textContent = '🎉';
        title.textContent = '红军胜利！';
        title.className = 'victory-title red-win';
        sub.textContent = winner === myFaction ? '恭喜你获胜！' : '红军消灭了所有土匪';
    } else {
        icon.textContent = '💀';
        title.textContent = '土匪胜利！';
        title.className = 'victory-title bandit-win';
        sub.textContent = winner === myFaction ? '恭喜你获胜！' : '红军被包围了';
    }
    showOverlay('victoryOverlay');
});

// 棋盘绘制
function getPointCoord(index) {
    return {
        x: (index % POINTS) * GRID_SIZE + OFFSET,
        y: Math.floor(index / POINTS) * GRID_SIZE + OFFSET
    };
}

function areConnected(p1, p2) {
    return connections.some(([a, b]) => (a === p1 && b === p2) || (a === p2 && b === p1));
}

function drawBoard() {
    const canvas = document.getElementById('boardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    
    for (const [p1, p2] of connections) {
        const c1 = getPointCoord(p1);
        const c2 = getPointCoord(p2);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.stroke();
    }
    
    ctx.fillStyle = '#5a5a7a';
    for (let i = 0; i < POINTS * POINTS; i++) {
        const { x, y } = getPointCoord(i);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function isOccupied(pos) {
    if (!gameState) return false;
    return gameState.redPositions.includes(pos) || gameState.bandits.includes(pos);
}

function getNeighbors(pos) {
    const neighbors = [];
    for (let i = 0; i < POINTS * POINTS; i++) {
        if (areConnected(pos, i)) neighbors.push(i);
    }
    return neighbors;
}

function getCaptureMoves(pos) {
    const captures = [];
    const neighbors = getNeighbors(pos);
    for (const neighbor of neighbors) {
        if (!isOccupied(neighbor)) {
            const dx = (neighbor % POINTS) - (pos % POINTS);
            const dy = Math.floor(neighbor / POINTS) - Math.floor(pos / POINTS);
            const targetX = (neighbor % POINTS) + dx;
            const targetY = Math.floor(neighbor / POINTS) + dy;
            if (targetX >= 0 && targetX < POINTS && targetY >= 0 && targetY < POINTS) {
                const target = targetY * POINTS + targetX;
                if (gameState.bandits.includes(target) && areConnected(neighbor, target)) {
                    captures.push({ target, captured: target });
                }
            }
        }
    }
    return captures;
}

function getValidMoves(pos, isRed) {
    const moves = [];
    const neighbors = getNeighbors(pos);
    for (const neighbor of neighbors) {
        if (!isOccupied(neighbor)) {
            moves.push({ target: neighbor, captured: null });
        }
    }
    if (isRed) {
        moves.push(...getCaptureMoves(pos));
    }
    return moves;
}

function canRedMove() {
    if (!gameState) return true;
    for (const pos of gameState.redPositions) {
        if (getValidMoves(pos, true).length > 0) return true;
    }
    return false;
}


// 渲染棋子
function renderPieces() {
    const board = document.getElementById('board');
    if (!board) return;
    document.querySelectorAll('.piece, .valid-move').forEach(el => el.remove());
    
    if (!gameState) return;
    
    const isMyTurn = gameState.turn === myFaction && !gameState.gameOver;
    
    gameState.redPositions.forEach((pos, index) => {
        const coord = getPointCoord(pos);
        const piece = document.createElement('div');
        const isSelected = selectedPiece?.type === 'red' && selectedPiece?.index === index;
        piece.className = 'piece red' + (isSelected ? ' selected' : '');
        if (myFaction !== 'red' || !isMyTurn) piece.classList.add('disabled');
        piece.style.left = coord.x + 'px';
        piece.style.top = coord.y + 'px';
        piece.textContent = '红';
        piece.onclick = () => selectPiece('red', index);
        board.appendChild(piece);
    });
    
    gameState.bandits.forEach((pos, index) => {
        const coord = getPointCoord(pos);
        const piece = document.createElement('div');
        const isSelected = selectedPiece?.type === 'bandit' && selectedPiece?.index === index;
        piece.className = 'piece bandit' + (isSelected ? ' selected' : '');
        if (myFaction !== 'bandit' || !isMyTurn) piece.classList.add('disabled');
        piece.style.left = coord.x + 'px';
        piece.style.top = coord.y + 'px';
        piece.textContent = '匪';
        piece.onclick = () => selectPiece('bandit', index);
        board.appendChild(piece);
    });
    
    validMoves.forEach(move => {
        const coord = getPointCoord(move.target);
        const marker = document.createElement('div');
        marker.className = 'valid-move';
        marker.style.left = coord.x + 'px';
        marker.style.top = coord.y + 'px';
        marker.onclick = () => makeMove(move);
        board.appendChild(marker);
    });
}

function selectPiece(type, index) {
    if (!gameState || gameState.gameOver) return;
    if (gameState.turn !== myFaction) return;
    if (type !== myFaction) return;
    
    const pos = type === 'red' ? gameState.redPositions[index] : gameState.bandits[index];
    selectedPiece = { type, index };
    validMoves = getValidMoves(pos, type === 'red');
    renderPieces();
}

function makeMove(move) {
    if (!selectedPiece) return;
    socket.emit('makeMove', {
        pieceIndex: selectedPiece.index,
        target: move.target,
        captured: move.captured
    });
    selectedPiece = null;
    validMoves = [];
}

function updateStatus() {
    const status = document.getElementById('status');
    const redIcon = document.getElementById('redIcon');
    const banditIcon = document.getElementById('banditIcon');
    
    if (!gameState) {
        status.textContent = '等待开始';
        return;
    }
    
    if (gameState.gameOver) {
        status.textContent = gameState.winner === 'red' ? '红军胜！' : '土匪胜！';
    } else {
        const isMyTurn = gameState.turn === myFaction;
        status.textContent = gameState.turn === 'red' ? '红军回合' : '土匪回合';
        if (isMyTurn) status.textContent += ' (你)';
    }
    
    redIcon?.classList.toggle('active', gameState.turn === 'red' && !gameState.gameOver);
    banditIcon?.classList.toggle('active', gameState.turn === 'bandit' && !gameState.gameOver);
}

// 悔棋
function requestUndo() {
    socket.emit('requestUndo');
    showToast('已发送悔棋请求');
}

socket.on('undoRequested', (faction) => {
    showOverlay('undoRequestOverlay');
});

function respondUndo(accepted) {
    hideOverlay('undoRequestOverlay');
    socket.emit('respondUndo', accepted);
}

socket.on('undoAccepted', (state) => {
    gameState = state;
    selectedPiece = null;
    validMoves = [];
    updateStatus();
    renderPieces();
    showToast('悔棋成功');
    addChatMessage('system', '悔棋成功');
});

socket.on('undoRejected', (msg) => {
    showToast(msg || '悔棋被拒绝');
});


// 求和
function requestDraw() {
    socket.emit('requestDraw');
    showToast('已发送求和请求');
}

socket.on('drawRequested', (faction) => {
    showOverlay('drawRequestOverlay');
});

function respondDraw(accepted) {
    hideOverlay('drawRequestOverlay');
    socket.emit('respondDraw', accepted);
}

socket.on('drawRejected', () => {
    showToast('对方拒绝求和');
});

// 再来一局
function requestRematch() {
    hideOverlay('victoryOverlay');
    socket.emit('requestRematch');
    showToast('已发送再来一局请求');
}

socket.on('rematchRequested', (faction) => {
    hideOverlay('victoryOverlay');
    showOverlay('rematchRequestOverlay');
});

function respondRematch(accepted) {
    hideOverlay('rematchRequestOverlay');
    socket.emit('respondRematch', accepted);
}

socket.on('rematchAccepted', () => {
    // 保持原阵营，红军方重新布阵
    if (myFaction === 'red') {
        setupPositions = [];
        updateSetupUI();
        showOverlay('setupPanel');
    } else {
        socket.emit('playerReady', null);
        document.getElementById('status').textContent = '等待红军布阵...';
    }
    addChatMessage('system', '再来一局！');
});

socket.on('rematchRejected', () => {
    showToast('对方拒绝再来一局');
});

// 交换阵营
function requestSwapFaction() {
    socket.emit('requestSwapFaction');
    showToast('已发送交换阵营请求');
}

socket.on('swapRequested', (faction) => {
    showOverlay('swapRequestOverlay');
});

function respondSwap(accepted) {
    hideOverlay('swapRequestOverlay');
    socket.emit('respondSwap', accepted);
}

socket.on('swapAccepted', () => {
    // 交换阵营
    myFaction = myFaction === 'red' ? 'bandit' : 'red';
    const factionDisplay = document.getElementById('myFactionDisplay');
    factionDisplay.textContent = myFaction === 'red' ? '⭐ 红军方' : '💀 土匪方';
    factionDisplay.className = 'my-faction ' + myFaction;
    
    hideOverlay('setupPanel');
    
    // 新红军方布阵
    if (myFaction === 'red') {
        setupPositions = [];
        updateSetupUI();
        showOverlay('setupPanel');
    } else {
        socket.emit('playerReady', null);
        document.getElementById('status').textContent = '等待红军布阵...';
    }
    addChatMessage('system', '阵营已交换！');
});

socket.on('swapRejected', () => {
    showToast('对方拒绝交换阵营');
});

// 聊天
function sendChat() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chatMessage', msg);
    input.value = '';
}

document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

socket.on('chatMessage', (data) => {
    addChatMessage(data.faction, data.message, data.time);
});

function addChatMessage(faction, message, time) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg ' + faction;
    
    if (faction !== 'system') {
        const sender = document.createElement('div');
        sender.className = 'sender';
        sender.textContent = (faction === 'red' ? '红军' : '土匪') + (time ? ' ' + time : '');
        msgEl.appendChild(sender);
    }
    
    const text = document.createElement('div');
    text.textContent = message;
    msgEl.appendChild(text);
    
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

// 表情
function sendEmoji(emoji) {
    socket.emit('sendEmoji', emoji);
}

socket.on('emojiReceived', (data) => {
    showFloatingEmoji(data.emoji, data.faction);
    addChatMessage(data.faction, data.emoji);
});

function showFloatingEmoji(emoji, faction) {
    const el = document.createElement('div');
    el.className = 'emoji-float';
    el.textContent = emoji;
    el.style.left = faction === 'red' ? '30%' : '70%';
    el.style.top = '50%';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// 初始化
initConnections();
