// 红军土匪棋 - 游戏逻辑 (根据百度百科规则)
const GRID_SIZE = 60;
const OFFSET = 40;
const POINTS = 5; // 5x5 棋盘

// 棋盘连接关系
const connections = [];

// 历史记录（用于悔棋）
let history = [];

// 初始化连接关系
function initConnections() {
    // 横向连接
    for (let y = 0; y < POINTS; y++) {
        for (let x = 0; x < POINTS - 1; x++) {
            connections.push([y * POINTS + x, y * POINTS + x + 1]);
        }
    }
    // 纵向连接
    for (let x = 0; x < POINTS; x++) {
        for (let y = 0; y < POINTS - 1; y++) {
            connections.push([y * POINTS + x, (y + 1) * POINTS + x]);
        }
    }
}

// 游戏状态
let gameState = {
    redPositions: [],
    bandits: [],
    turn: 'red',
    selected: null,
    validMoves: [],
    gameOver: false,
    winner: null
};

// 获取点的坐标
function getPointCoord(index) {
    const x = (index % POINTS) * GRID_SIZE + OFFSET;
    const y = Math.floor(index / POINTS) * GRID_SIZE + OFFSET;
    return { x, y };
}

// 检查两点是否相连
function areConnected(p1, p2) {
    return connections.some(([a, b]) => 
        (a === p1 && b === p2) || (a === p2 && b === p1)
    );
}


// 获取相邻点
function getNeighbors(pos) {
    const neighbors = [];
    for (let i = 0; i < POINTS * POINTS; i++) {
        if (areConnected(pos, i)) neighbors.push(i);
    }
    return neighbors;
}

// 检查位置是否被占用
function isOccupied(pos) {
    return gameState.redPositions.includes(pos) || gameState.bandits.includes(pos);
}

// 获取红军可吃子的位置 (红军与土匪之间必须间隔一个空位)
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

// 获取有效移动
function getValidMoves(pos, isRed) {
    const moves = [];
    const neighbors = getNeighbors(pos);
    
    for (const neighbor of neighbors) {
        if (!isOccupied(neighbor)) {
            moves.push({ target: neighbor, captured: null });
        }
    }
    
    if (isRed) {
        const captures = getCaptureMoves(pos);
        moves.push(...captures);
    }
    
    return moves;
}

// 检查红军是否还能移动
function canRedMove() {
    for (const pos of gameState.redPositions) {
        if (getValidMoves(pos, true).length > 0) return true;
    }
    return false;
}


// 绘制棋盘
function drawBoard() {
    const canvas = document.getElementById('boardCanvas');
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

// 渲染棋子
function renderPieces() {
    const board = document.getElementById('board');
    document.querySelectorAll('.piece, .valid-move').forEach(el => el.remove());
    
    gameState.redPositions.forEach((pos, index) => {
        const coord = getPointCoord(pos);
        const piece = document.createElement('div');
        piece.className = 'piece red' + (gameState.selected?.type === 'red' && gameState.selected?.index === index ? ' selected' : '');
        piece.style.left = coord.x + 'px';
        piece.style.top = coord.y + 'px';
        piece.textContent = '红';
        piece.onclick = () => selectPiece('red', index);
        board.appendChild(piece);
    });
    
    gameState.bandits.forEach((pos, index) => {
        const coord = getPointCoord(pos);
        const piece = document.createElement('div');
        piece.className = 'piece bandit' + (gameState.selected?.type === 'bandit' && gameState.selected?.index === index ? ' selected' : '');
        piece.style.left = coord.x + 'px';
        piece.style.top = coord.y + 'px';
        piece.textContent = '匪';
        piece.onclick = () => selectPiece('bandit', index);
        board.appendChild(piece);
    });
    
    gameState.validMoves.forEach(move => {
        const coord = getPointCoord(move.target);
        const marker = document.createElement('div');
        marker.className = 'valid-move';
        marker.style.left = coord.x + 'px';
        marker.style.top = coord.y + 'px';
        marker.onclick = () => makeMove(move);
        board.appendChild(marker);
    });
}


// 选择棋子
function selectPiece(type, index) {
    if (gameState.gameOver) return;
    
    const clickedPos = type === 'red' ? gameState.redPositions[index] : gameState.bandits[index];
    const move = gameState.validMoves.find(m => m.target === clickedPos);
    if (move) {
        makeMove(move);
        return;
    }
    
    if (gameState.turn === 'red' && type === 'red') {
        gameState.selected = { type: 'red', index };
        gameState.validMoves = getValidMoves(gameState.redPositions[index], true);
    } else if (gameState.turn === 'bandit' && type === 'bandit') {
        gameState.selected = { type: 'bandit', index };
        gameState.validMoves = getValidMoves(gameState.bandits[index], false);
    } else {
        gameState.selected = null;
        gameState.validMoves = [];
    }
    
    renderPieces();
}

// 保存状态到历史
function saveHistory() {
    const snapshot = {
        redPositions: [...gameState.redPositions],
        bandits: [...gameState.bandits],
        turn: gameState.turn
    };
    history.push(snapshot);
    console.log('保存历史，当前记录数:', history.length);
}

// 执行移动
function makeMove(move) {
    saveHistory();
    
    if (gameState.turn === 'red') {
        gameState.redPositions[gameState.selected.index] = move.target;
        if (move.captured !== null) {
            gameState.bandits = gameState.bandits.filter(p => p !== move.captured);
        }
        gameState.turn = 'bandit';
    } else {
        gameState.bandits[gameState.selected.index] = move.target;
        gameState.turn = 'red';
    }
    
    gameState.selected = null;
    gameState.validMoves = [];
    
    checkGameOver();
    updateStatus();
    renderPieces();
}

// 悔棋
function undoMove() {
    if (history.length === 0) {
        alert('没有可以悔棋的步骤');
        return;
    }
    
    const prev = history.pop();
    gameState.redPositions = [...prev.redPositions];
    gameState.bandits = [...prev.bandits];
    gameState.turn = prev.turn;
    gameState.selected = null;
    gameState.validMoves = [];
    gameState.gameOver = false;
    gameState.winner = null;
    
    updateStatus();
    renderPieces();
    console.log('悔棋成功，历史记录剩余:', history.length);
}


// 检查游戏结束
function checkGameOver() {
    if (gameState.bandits.length === 0) {
        gameState.gameOver = true;
        gameState.winner = 'red';
        showVictory('red');
        return;
    }
    
    if (gameState.turn === 'red' && !canRedMove()) {
        gameState.gameOver = true;
        gameState.winner = 'bandit';
        showVictory('bandit');
        return;
    }
}

// 显示胜利画面
function showVictory(winner) {
    const overlay = document.getElementById('victoryOverlay');
    const icon = document.getElementById('victoryIcon');
    const title = document.getElementById('victoryTitle');
    const sub = document.getElementById('victorySub');
    
    if (winner === 'red') {
        icon.textContent = '🎉';
        title.textContent = '红军胜利！';
        title.className = 'victory-title red-win';
        sub.textContent = '成功消灭所有土匪';
    } else {
        icon.textContent = '💀';
        title.textContent = '土匪胜利！';
        title.className = 'victory-title bandit-win';
        sub.textContent = '成功包围红军';
    }
    
    overlay.classList.add('show');
}

// 关闭胜利画面并重置
function closeVictoryAndReset() {
    document.getElementById('victoryOverlay').classList.remove('show');
    showSetupPanel();
}

// 更新回合图标
function updateTurnIcons() {
    const redIcon = document.getElementById('redIcon');
    const banditIcon = document.getElementById('banditIcon');
    
    if (redIcon && banditIcon) {
        // 先移除所有active类
        redIcon.classList.remove('active');
        banditIcon.classList.remove('active');
        
        // 根据当前回合添加active类
        if (!gameState.gameOver) {
            if (gameState.turn === 'red') {
                redIcon.classList.add('active');
            } else {
                banditIcon.classList.add('active');
            }
        }
    }
}

// 更新状态显示
function updateStatus() {
    const status = document.getElementById('status');
    
    if (gameState.gameOver) {
        status.textContent = gameState.winner === 'red' ? '🎉 红军胜！' : '💀 土匪胜！';
        status.style.background = gameState.winner === 'red' ? 'rgba(231,76,60,0.3)' : 'rgba(100,100,100,0.3)';
    } else {
        const banditCount = gameState.bandits.length;
        status.textContent = gameState.turn === 'red' ? `红军回合` : `土匪回合`;
        status.style.background = 'rgba(255,255,255,0.1)';
    }
    
    updateTurnIcons();
}

// 布局选择相关
let setupPositions = [];

// 显示布局选择面板
function showSetupPanel() {
    setupPositions = [];
    updateSetupUI();
    document.getElementById('setupPanel').classList.add('show');
}

// 更新布局选择UI
function updateSetupUI() {
    const positions = document.querySelectorAll('.setup-pos');
    positions.forEach(pos => {
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
    document.getElementById('confirmBtn').disabled = setupPositions.length !== 3;
}

// 切换位置选择
function toggleSetupPosition(pos) {
    const index = setupPositions.indexOf(pos);
    if (index > -1) {
        setupPositions.splice(index, 1);
    } else if (setupPositions.length < 3) {
        setupPositions.push(pos);
    }
    updateSetupUI();
}

// 跳过布局选择，使用默认
function skipSetup() {
    document.getElementById('setupPanel').classList.remove('show');
    startGame([20, 22, 24]);
}

// 确认布局
function confirmSetup() {
    if (setupPositions.length !== 3) return;
    document.getElementById('setupPanel').classList.remove('show');
    startGame([...setupPositions].sort((a, b) => a - b));
}

// 开始游戏
function startGame(redPos) {
    history = [];
    gameState = {
        redPositions: redPos,
        bandits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        turn: 'red',
        selected: null,
        validMoves: [],
        gameOver: false,
        winner: null
    };
    updateStatus();
    renderPieces();
}

// 重置游戏（显示布局选择）
function resetGame() {
    document.getElementById('victoryOverlay').classList.remove('show');
    showSetupPanel();
}

// 初始化游戏
function init() {
    initConnections();
    drawBoard();
    
    // 绑定布局选择点击事件
    document.querySelectorAll('.setup-pos').forEach(pos => {
        pos.addEventListener('click', () => {
            toggleSetupPosition(parseInt(pos.dataset.pos));
        });
    });
    
    // 显示布局选择面板
    showSetupPanel();
}

init();
