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
let opponentSelectedPiece = null; // 对方选中的棋子
let validMoves = [];
let setupPositions = [];
let isSpectator = false;
const connections = [];

// 音效系统（单例，防重叠）
let audioCtx = null;
let soundsInitialized = false;
let lastPlayedSound = 0;

function initSounds() {
    if (soundsInitialized) return;
    soundsInitialized = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(name) {
    if (!audioCtx) return;
    
    // 防止音效重叠，300ms内不重复播放
    const now = Date.now();
    if (now - lastPlayedSound < 300) return;
    lastPlayedSound = now;
    
    // 确保 AudioContext 处于运行状态
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (name === 'move') {
        osc.frequency.value = 600;
        gain.gain.value = 0.08;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.stop(audioCtx.currentTime + 0.1);
    } else if (name === 'capture') {
        osc.frequency.value = 600;
        gain.gain.value = 0.1;
        osc.start();
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.stop(audioCtx.currentTime + 0.15);
    } else if (name === 'win') {
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            setTimeout(() => {
                if (!audioCtx) return;
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g);
                g.connect(audioCtx.destination);
                o.frequency.value = freq;
                g.gain.value = 0.08;
                o.start();
                g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
                o.stop(audioCtx.currentTime + 0.3);
            }, i * 150);
        });
    }
}

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
    document.querySelectorAll('#mainMenu, #createRoomPanel, #joinRoomPanel, #waitingPanel, #roomListPanel')
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
function showRoomList() { showPanel('roomListPanel'); refreshRoomList(); }
function backToMenu() { showPanel('mainMenu'); }

function refreshRoomList() {
    socket.emit('getRoomList');
}

socket.on('roomList', (rooms) => {
    const container = document.getElementById('roomList');
    if (rooms.length === 0) {
        container.innerHTML = '<p class="no-rooms">暂无房间</p>';
        return;
    }
    container.innerHTML = rooms.map(room => {
        const statusText = room.isPlaying ? '游戏中' : 
            (room.canJoin ? `${room.faction === 'red' ? '红军' : '土匪'}方等待中` : '等待开始');
        return `
        <div class="room-item">
            <div class="room-item-info">
                <div class="room-item-id">${room.id}</div>
                <div class="room-item-status">
                    ${room.playerCount}/2 玩家 | ${room.spectatorCount} 观众 | ${statusText}
                </div>
            </div>
            <div class="room-item-btns">
                ${room.canJoin ? `<button class="btn-join" onclick="quickJoinRoom('${room.id}', '${room.faction === 'red' ? 'bandit' : 'red'}')">加入</button>` : ''}
                <button class="btn-spectate" onclick="spectateRoom('${room.id}')">观战</button>
            </div>
        </div>
    `}).join('');
});

function quickJoinRoom(roomId, faction) {
    socket.emit('joinRoom', { roomId, faction });
}

function spectateRoom(roomId) {
    socket.emit('spectateRoom', roomId);
}

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
    isSpectator = false;
    hideOverlay('victoryOverlay');
    hideOverlay('setupPanel');
    showScreen('lobbyScreen');
    showPanel('mainMenu');
    // 恢复玩家UI
    const controls = document.querySelector('.controls');
    const chatBox = document.querySelector('.chat-box');
    if (controls) controls.style.display = '';
    if (chatBox) chatBox.style.display = '';
    // 移除观众面板
    const spectatorPanel = document.querySelector('.spectator-panel');
    if (spectatorPanel) spectatorPanel.remove();
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

// 观战相关
socket.on('spectateJoined', (data) => {
    roomId = data.roomId;
    isSpectator = true;
    gameState = data.gameState;
    enterGameAsSpectator();
    // 更新观众数量
    const countEl = document.getElementById('spectatorCount');
    if (countEl) countEl.textContent = data.spectatorCount;
    if (gameState) {
        updateStatus();
        renderPieces();
    }
});

socket.on('spectatorUpdate', (data) => {
    const countEl = document.getElementById('spectatorCount');
    if (countEl) countEl.textContent = data.count;
});

socket.on('spectatorEmojiReceived', (data) => {
    showSpectatorEmoji(data.emoji);
});

socket.on('roomClosed', () => {
    showToast('房间已关闭');
    leaveRoom();
});

function showSpectatorEmoji(emoji) {
    const container = document.getElementById('spectatorEmojiContainer');
    if (!container) return;
    
    // 限制最多显示3个表情
    const existing = container.querySelectorAll('.spectator-emoji-float');
    if (existing.length >= 3) {
        existing[0].remove();
    }
    
    const el = document.createElement('span');
    el.className = 'spectator-emoji-float';
    el.textContent = emoji;
    // 随机位置偏移，让表情分散显示
    el.style.marginLeft = Math.random() * 30 + 'px';
    container.appendChild(el);
    
    // 2秒后移除
    setTimeout(() => {
        el.remove();
    }, 2000);
}

function sendSpectatorEmoji(emoji) {
    socket.emit('spectatorEmoji', emoji);
}

function enterGame() {
    showScreen('gameScreen');
    document.getElementById('gameRoomId').textContent = roomId;
    const factionDisplay = document.getElementById('myFactionDisplay');
    factionDisplay.textContent = myFaction === 'red' ? '⭐ 红军方' : '💀 土匪方';
    factionDisplay.className = 'my-faction ' + myFaction;
    document.getElementById('spectatorBadge').classList.remove('show');
    
    initConnections();
    initSounds();
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

function enterGameAsSpectator() {
    showScreen('gameScreen');
    document.getElementById('gameRoomId').textContent = roomId;
    document.getElementById('myFactionDisplay').textContent = '';
    document.getElementById('myFactionDisplay').className = 'my-faction';
    document.getElementById('spectatorBadge').classList.add('show');
    
    // 隐藏玩家控制按钮、聊天框，显示观众面板
    document.querySelector('.controls').style.display = 'none';
    document.querySelector('.chat-box').style.display = 'none';
    showSpectatorPanel();
    
    initConnections();
    initSounds();
    drawBoard();
}

function showSpectatorPanel() {
    const gameRight = document.querySelector('.game-right');
    if (!gameRight) return;
    
    // 移除已有的观众面板
    const existing = document.querySelector('.spectator-panel');
    if (existing) existing.remove();
    
    const panel = document.createElement('div');
    panel.className = 'spectator-panel';
    panel.innerHTML = `
        <div class="spectator-panel-header">👁 观战模式</div>
        <div class="spectator-panel-info">你正在观看比赛</div>
        <div class="spectator-emoji-bar show">
            <span class="emoji-btn" onclick="sendSpectatorEmoji('👍')">👍</span>
            <span class="emoji-btn" onclick="sendSpectatorEmoji('😄')">😄</span>
            <span class="emoji-btn" onclick="sendSpectatorEmoji('😮')">😮</span>
            <span class="emoji-btn" onclick="sendSpectatorEmoji('👏')">👏</span>
            <span class="emoji-btn" onclick="sendSpectatorEmoji('🔥')">🔥</span>
        </div>
        <button class="spectator-leave-btn" onclick="leaveRoom()">退出观战</button>
    `;
    gameRight.appendChild(panel);
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
let lastGameState = null;
let isAnimating = false;

socket.on('gameStart', (state) => {
    gameState = state;
    lastGameState = JSON.parse(JSON.stringify(state));
    isAnimating = false;
    selectedPiece = null;
    opponentSelectedPiece = null;
    validMoves = [];
    updateStatus();
    renderPieces();
});

socket.on('gameUpdate', (state) => {
    const prevState = lastGameState;
    lastGameState = JSON.parse(JSON.stringify(state));
    
    // 检测移动并播放动画
    if (prevState && !state.gameOver) {
        animateMove(prevState, state, () => {
            gameState = state;
            selectedPiece = null;
            opponentSelectedPiece = null;
            validMoves = [];
            updateStatus();
            renderPieces();
            
            // 检查红军是否被困
            if (gameState.turn === 'red' && myFaction === 'red' && !canRedMove()) {
                socket.emit('redTrapped');
            }
        });
    } else {
        gameState = state;
        selectedPiece = null;
        opponentSelectedPiece = null;
        validMoves = [];
        updateStatus();
        renderPieces();
    }
});

function animateMove(prevState, newState, callback) {
    // 防止重复动画
    if (isAnimating) {
        callback();
        return;
    }
    
    // 找出哪个棋子移动了
    let movedPiece = null;
    let fromPos = null;
    let toPos = null;
    let captured = false;
    
    // 根据回合判断是谁移动的
    // newState.turn 是下一个回合，所以上一步是对方走的
    const whoMoved = newState.turn === 'red' ? 'bandit' : 'red';
    
    if (whoMoved === 'red') {
        // 检查红军移动
        for (let i = 0; i < prevState.redPositions.length; i++) {
            if (prevState.redPositions[i] !== newState.redPositions[i]) {
                movedPiece = { type: 'red', index: i };
                fromPos = prevState.redPositions[i];
                toPos = newState.redPositions[i];
                break;
            }
        }
    } else {
        // 检查土匪移动
        for (let i = 0; i < Math.min(prevState.bandits.length, newState.bandits.length); i++) {
            if (prevState.bandits[i] !== newState.bandits[i]) {
                movedPiece = { type: 'bandit', index: i };
                fromPos = prevState.bandits[i];
                toPos = newState.bandits[i];
                break;
            }
        }
    }
    
    // 检查是否有吃子
    captured = prevState.bandits.length > newState.bandits.length;
    
    if (!movedPiece) {
        callback();
        return;
    }
    
    isAnimating = true;
    
    // 播放音效
    if (captured) {
        playSound('capture');
    } else {
        playSound('move');
    }
    
    // 执行动画
    const board = document.getElementById('board');
    const pieces = board.querySelectorAll('.piece');
    let targetPiece = null;
    
    pieces.forEach(p => {
        const coord = getPointCoord(fromPos);
        const pieceX = parseInt(p.style.left);
        const pieceY = parseInt(p.style.top);
        if (Math.abs(pieceX - coord.x) < 5 && Math.abs(pieceY - coord.y) < 5) {
            targetPiece = p;
        }
    });
    
    if (targetPiece) {
        targetPiece.classList.add('moving');
        const toCoord = getPointCoord(toPos);
        targetPiece.style.left = toCoord.x + 'px';
        targetPiece.style.top = toCoord.y + 'px';
        setTimeout(() => {
            isAnimating = false;
            callback();
        }, 300);
    } else {
        isAnimating = false;
        callback();
    }
}

// 对方选中棋子
socket.on('opponentPieceSelected', (data) => {
    opponentSelectedPiece = data;
    renderPieces();
});

socket.on('gameOver', (winner) => {
    const icon = document.getElementById('victoryIcon');
    const title = document.getElementById('victoryTitle');
    const sub = document.getElementById('victorySub');
    
    // 播放胜利音效
    if (winner === myFaction || (isSpectator && winner !== 'draw')) {
        playSound('win');
    }
    
    if (winner === 'draw') {
        icon.textContent = '🤝';
        title.textContent = '和棋！';
        title.className = 'victory-title';
        sub.textContent = '双方握手言和';
    } else if (winner === 'red') {
        icon.textContent = '🎉';
        title.textContent = '红军胜利！';
        title.className = 'victory-title red-win';
        sub.textContent = winner === myFaction ? '恭喜你获胜！' : (isSpectator ? '红军消灭了所有土匪' : '红军消灭了所有土匪');
    } else {
        icon.textContent = '💀';
        title.textContent = '土匪胜利！';
        title.className = 'victory-title bandit-win';
        sub.textContent = winner === myFaction ? '恭喜你获胜！' : (isSpectator ? '红军被包围了' : '红军被包围了');
    }
    
    // 观众只能看结果，隐藏再来一局按钮
    const victoryBtns = document.querySelector('#victoryOverlay .modal-btns');
    if (victoryBtns) {
        victoryBtns.style.display = isSpectator ? 'none' : '';
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
    const currentTurn = gameState.turn; // 当前轮到哪方
    
    gameState.redPositions.forEach((pos, index) => {
        const coord = getPointCoord(pos);
        const piece = document.createElement('div');
        const isSelected = selectedPiece?.type === 'red' && selectedPiece?.index === index;
        const isOpponentSelected = opponentSelectedPiece?.type === 'red' && opponentSelectedPiece?.index === index;
        piece.className = 'piece red' + (isSelected ? ' selected' : '');
        if (myFaction !== 'red' || !isMyTurn) piece.classList.add('disabled');
        // 轮到红方时红棋更亮，否则变暗
        piece.classList.add(currentTurn === 'red' ? 'active-turn' : 'inactive');
        // 对方选中效果
        if (isOpponentSelected) piece.classList.add('opponent-selected');
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
        const isOpponentSelected = opponentSelectedPiece?.type === 'bandit' && opponentSelectedPiece?.index === index;
        piece.className = 'piece bandit' + (isSelected ? ' selected' : '');
        if (myFaction !== 'bandit' || !isMyTurn) piece.classList.add('disabled');
        // 轮到匪方时匪棋更亮，否则变暗
        piece.classList.add(currentTurn === 'bandit' ? 'active-turn' : 'inactive');
        // 对方选中效果
        if (isOpponentSelected) piece.classList.add('opponent-selected');
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
    if (isSpectator) return; // 观众不能选棋
    if (!gameState || gameState.gameOver) return;
    if (gameState.turn !== myFaction) return;
    if (type !== myFaction) return;
    
    const pos = type === 'red' ? gameState.redPositions[index] : gameState.bandits[index];
    selectedPiece = { type, index };
    validMoves = getValidMoves(pos, type === 'red');
    // 通知对方我选中了哪个棋子
    socket.emit('pieceSelected', { type, index });
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
    if (isSpectator) return; // 观众不处理
    showOverlay('undoRequestOverlay');
});

function respondUndo(accepted) {
    hideOverlay('undoRequestOverlay');
    socket.emit('respondUndo', accepted);
}

socket.on('undoAccepted', (state) => {
    gameState = state;
    lastGameState = JSON.parse(JSON.stringify(state)); // 更新lastGameState
    selectedPiece = null;
    validMoves = [];
    updateStatus();
    renderPieces();
    showToast('悔棋成功');
});

socket.on('undoRejected', (msg) => {
    showToast(msg || '对方拒绝悔棋');
});

socket.on('undoRejectedByMe', () => {
    showToast('已拒绝对方悔棋');
});


// 求和
function requestDraw() {
    socket.emit('requestDraw');
    showToast('已发送求和请求');
}

socket.on('drawRequested', (faction) => {
    if (isSpectator) return; // 观众不处理
    showOverlay('drawRequestOverlay');
});

function respondDraw(accepted) {
    hideOverlay('drawRequestOverlay');
    socket.emit('respondDraw', accepted);
}

socket.on('drawRejected', () => {
    showToast('对方拒绝求和');
});

socket.on('drawRejectedByMe', () => {
    showToast('已拒绝求和');
});

// 再来一局
function requestRematch() {
    socket.emit('requestRematch');
    showToast('已发送再来一局请求');
}

socket.on('rematchRequested', (faction) => {
    if (isSpectator) return; // 观众不处理
    hideOverlay('victoryOverlay');
    showOverlay('rematchRequestOverlay');
});

function respondRematch(accepted) {
    hideOverlay('rematchRequestOverlay');
    socket.emit('respondRematch', accepted);
}

socket.on('rematchAccepted', (data) => {
    hideOverlay('victoryOverlay');
    // 保持原阵营，红军方重新布阵
    if (myFaction === 'red') {
        setupPositions = [];
        updateSetupUI();
        showOverlay('setupPanel');
    } else {
        socket.emit('playerReady', null);
        document.getElementById('status').textContent = '等待红军布阵...';
    }
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
    if (isSpectator) return; // 观众不处理
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
    showToast('阵营已交换');
});

socket.on('swapRejected', () => {
    showToast('对方拒绝交换阵营');
});

socket.on('swapRejectedByMe', () => {
    showToast('已拒绝交换阵营');
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
    const isMe = data.faction === myFaction;
    addChatMessage(isMe ? 'me' : 'opponent', data.message, data.time);
});

function addChatMessage(who, message, time) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg ' + who;
    
    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = (who === 'me' ? '我' : '对方') + (time ? ' ' + time : '');
    msgEl.appendChild(sender);
    
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
    const isMe = data.faction === myFaction;
    showFloatingEmoji(data.emoji, isMe ? 'me' : 'opponent');
    addChatMessage(isMe ? 'me' : 'opponent', data.emoji);
});

function showFloatingEmoji(emoji, who) {
    const el = document.createElement('div');
    el.className = 'emoji-float';
    el.textContent = emoji;
    el.style.left = who === 'me' ? '70%' : '30%';
    el.style.top = '50%';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// 初始化
initConnections();
