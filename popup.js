// 全域變數
let monarchs = [];
let serials = [];
let isRunning = false;
let shouldStop = false;
let debugLogs = []; // 詳細的 debug 日誌
let debugLogEnabled = true; // 是否輸出 debug log

// 初始化：從 storage 恢復狀態
async function initializePopup() {
  try {
    // 從 storage 讀取保存的狀態
    const result = await chrome.storage.local.get(['monarchs', 'serials', 'logs', 'monarchFileName', 'serialFileName', 'debugLogEnabled']);
    
    // 恢復數據
    if (result.monarchs && result.monarchs.length > 0) {
      monarchs = result.monarchs;
      monarchFileName.textContent = result.monarchFileName || `已載入 ${monarchs.length} 個主公`;
      monarchFileName.classList.add('loaded');
      checkFilesReady();
    }
    
    if (result.serials && result.serials.length > 0) {
      serials = result.serials;
      serialFileName.textContent = result.serialFileName || `已載入 ${serials.length} 個序號`;
      serialFileName.classList.add('loaded');
      checkFilesReady();
    }
    
    // 恢復 log
    if (result.logs && result.logs.length > 0) {
      logContent.innerHTML = result.logs;
      logContent.scrollTop = logContent.scrollHeight;
    } else {
      addLog('👋 準備就緒，請上傳文件', 'info');
    }
    
    // 恢復 debug logs
    if (result.debugLogs && result.debugLogs.length > 0) {
      debugLogs = result.debugLogs;
    }    
    // 恢覆 debug log 開關
    if (result.debugLogEnabled === false) {
      debugLogEnabled = false;
      debugLogToggle.checked = false;
      debugLogStatus.textContent = '關閉';
      debugLogStatus.className = 'toggle-status off';
    }  } catch (error) {
    console.error('載入狀態失敗', error);
    addLog('👋 準備就緒，請上傳文件', 'info');
  }
}

// 保存當前狀態到 storage
async function saveState() {
  try {
    await chrome.storage.local.set({
      monarchs: monarchs,
      serials: serials,
      logs: logContent.innerHTML,
      monarchFileName: monarchFileName.textContent,
      serialFileName: serialFileName.textContent,
      debugLogs: debugLogs,
      debugLogEnabled: debugLogEnabled
    });
  } catch (error) {
    console.error('保存狀態失敗', error);
  }
}

// DOM 元素
const monarchFile = document.getElementById('monarchFile');
const serialFile = document.getElementById('serialFile');
const monarchFileName = document.getElementById('monarchFileName');
const serialFileName = document.getElementById('serialFileName');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const openWebBtn = document.getElementById('openWebBtn');
const debugLogToggle = document.getElementById('debugLogToggle');
const debugLogStatus = document.getElementById('debugLogStatus');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logSection = document.getElementById('logSection');
const logContent = document.getElementById('logContent');

// Popup 開啟時初始化
document.addEventListener('DOMContentLoaded', () => {
  initializePopup();
});

// 文件上傳處理
monarchFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    monarchFileName.textContent = file.name;
    monarchFileName.classList.add('loaded');
    readFile(file, (content) => {
      monarchs = content.split('\n').map(line => line.trim()).filter(line => line);
      checkFilesReady();
      addLog(`已載入 ${monarchs.length} 個主公名稱`, 'info');
      saveState(); // 保存狀態
    });
  }
});

serialFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    serialFileName.textContent = file.name;
    serialFileName.classList.add('loaded');
    readFile(file, (content) => {
      serials = content.split('\n').map(line => line.trim()).filter(line => line);
      checkFilesReady();
      addLog(`已載入 ${serials.length} 個虛寶序號`, 'info');
      saveState(); // 保存狀態
    });
  }
});

// 讀取文件
function readFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => callback(e.target.result);
  reader.readAsText(file, 'UTF-8');
}

// 檢查文件是否都已上傳
function checkFilesReady() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  
  if (monarchs.length > 0 && serials.length > 0) {
    if (mode === 'oneToOne' && monarchs.length !== serials.length) {
      startBtn.disabled = true;
      addLog(`警告：一對一模式下，主公數量(${monarchs.length})與序號數量(${serials.length})不一致`, 'warning');
    } else {
      startBtn.disabled = false;
    }
  } else {
    startBtn.disabled = true;
  }
}

// 監聽模式切換
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', checkFilesReady);
});

// 開始執行
startBtn.addEventListener('click', async () => {
  if (monarchs.length === 0 || serials.length === 0) {
    alert('請先上傳主公名稱和虛寶序號文件！');
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;
  
  // 驗證一對一模式
  if (mode === 'oneToOne' && monarchs.length !== serials.length) {
    alert(`一對一模式下，主公數量(${monarchs.length})必須等於序號數量(${serials.length})！`);
    return;
  }

  isRunning = true;
  shouldStop = false;
  startBtn.disabled = true;
  stopBtn.style.display = 'block';
  progressSection.style.display = 'block';
  logSection.style.display = 'block';
  logContent.innerHTML = '';
  
  // 清空之前的 debug logs
  debugLogs = [];

  addLog('🚀 開始執行', 'info');
  addLog(`模式：${mode === 'oneToOne' ? '一對一' : '共用'} | 伺服器：天下爭霸`, 'info');
  
  addDebugLog('========== 開始新的執行 ==========');
  addDebugLog(`模式：${mode === 'oneToOne' ? '一對一' : '共用'}`);
  addDebugLog(`主公數量：${monarchs.length}`);
  addDebugLog(`序號數量：${serials.length}`);

  // 獲取當前活動標籤頁
  // const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // if (!tab) {
  //   addLog('❌ 錯誤：無法獲取當前標籤頁', 'error');
  //   addDebugLog('錯誤：無法獲取當前標籤頁');
  //   resetUI();
  //   return;
  // }
  
  // addDebugLog(`當前頁面：${tab.url}`);
  
  // // 先檢查頁面結構
  // addDebugLog('正在檢查頁面結構...');
  // try {
  //   const pageCheckResult = await checkPageStructure(tab.id);
  //   if (pageCheckResult.success) {
  //     addDebugLog('頁面結構檢查完成', pageCheckResult.pageInfo);
  //     // 不在 UI 顯示詳細頁面檢查結果
  //   }
  // } catch (error) {
  //   addLog(`❌ 頁面檢查失敗: ${error.message}`, 'error');
  //   addDebugLog(`頁面檢查失敗: ${error.message}`, error);
  //   resetUI();
  //   return;
  // }

  // 執行任務
  // 因為不再需要與頁面互動，所以 tab.id 已經不需要了
  if (mode === 'oneToOne') {
    await executeOneToOne();
  } else {
    await executeShared();
  }
});

// 停止執行
stopBtn.addEventListener('click', () => {
  shouldStop = true;
  addLog('正在停止執行...', 'warning');
});

// 清空資料
clearBtn.addEventListener('click', async () => {
  if (isRunning) {
    addLog('執行中無法清空，請先停止執行', 'warning');
    return;
  }
  
  if (confirm('確定要清空所有資料（包括上傳的文件和日誌）嗎？')) {
    // 清空 storage
    await chrome.storage.local.clear();
    
    // 重置 UI
    logContent.innerHTML = '';
    monarchFileName.textContent = '未選擇文件';
    monarchFileName.classList.remove('loaded');
    serialFileName.textContent = '未選擇文件';
    serialFileName.classList.remove('loaded');
    monarchFile.value = '';
    serialFile.value = '';
    
    // 清空數據
    monarchs = [];
    serials = [];
    debugLogs = []; // 清空 debug logs
    
    // 重置進度
    progressSection.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '';
    logSection.style.display = 'none';
    
    // 重置按鈕
    startBtn.disabled = true;
    
    addLog('✅ 已清空所有資料', 'success');
  }
});

// 前往兌換頁面按鈕不再需要，可以隱藏或刪除
openWebBtn.style.display = 'none';

// Debug Log 開關
debugLogToggle.addEventListener('change', () => {
  debugLogEnabled = debugLogToggle.checked;
  debugLogStatus.textContent = debugLogEnabled ? '開啟' : '關閉';
  debugLogStatus.className = `toggle-status ${debugLogEnabled ? 'on' : 'off'}`;
  chrome.storage.local.set({ debugLogEnabled: debugLogEnabled });
});

// 自動導出 debug.log
function autoExportLog() {
  if (!debugLogEnabled || debugLogs.length === 0) return;
  
  const content = [
    '='.repeat(80),
    '三國萌萌打虛寶序號自動填寫工具 - Debug Log',
    '='.repeat(80),
    `生成時間: ${new Date().toISOString()}`,
    `總日誌數: ${debugLogs.length}`,
    '='.repeat(80),
    '',
    ...debugLogs,
    '',
    '='.repeat(80),
    'End of Log',
    '='.repeat(80)
  ].join('\n');
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `debug_${new Date().toISOString().replace(/:/g, '-')}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  addLog('📥 Debug log 已自動下載', 'info');
}

// 一對一模式
async function executeOneToOne() {
  const total = monarchs.length;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < total; i++) {
    if (shouldStop) {
      addLog('執行已被用戶停止', 'warning');
      break;
    }

    const monarch = monarchs[i];
    const serial = serials[i];
    const progress = ((i + 1) / total * 100).toFixed(1);

    updateProgress(progress, `處理中 ${i + 1}/${total}`);
    
    addDebugLog(`[${i + 1}/${total}] 開始處理 - 主公：${monarch} | 序號：${serial}`);

    try {
      const response = await fillAndSubmit(monarch, serial);
      successCount++;
      
      addLog(`✅ ${monarch} 成功使用 ${serial}`, 'success');
      addDebugLog(`[${i + 1}/${total}] 成功 - 伺服器回應: ${JSON.stringify(response)}`);
    } catch (error) {
      errorCount++;
      
      const errorReason = error.message || '未知錯誤';
      addLog(`❌ ${monarch} 使用 ${serial} 失敗: ${errorReason}`, 'error');
      addDebugLog(`[${i + 1}/${total}] 失敗 - ${error.message}`, error);
    }

    // 延遲
    if (i < total - 1 && !shouldStop) {
      await sleep(500); // 可以縮短延遲
    }
  }

  // 完成
  updateProgress(100, '執行完成');
  addLog('========================================', 'info');
  addLog(`執行完成！成功：${successCount}，失敗：${errorCount}`, successCount > 0 ? 'success' : 'warning');
  autoExportLog();
  resetUI();
}

// 共用模式
async function executeShared() {
  const totalTasks = monarchs.length * serials.length;
  let taskIndex = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let s = 0; s < serials.length; s++) {
    if (shouldStop) {
      addLog('執行已被用戶停止', 'warning');
      break;
    }

    const serial = serials[s];
    addLog(`======== 序號：${serial} ========`, 'info');
    addDebugLog(`======== 開始使用序號：${serial} ========`);

    for (let m = 0; m < monarchs.length; m++) {
      if (shouldStop) break;

      const monarch = monarchs[m];
      taskIndex++;
      const progress = (taskIndex / totalTasks * 100).toFixed(1);

      updateProgress(progress, `處理中 ${taskIndex}/${totalTasks}`);
      addDebugLog(`[${taskIndex}/${totalTasks}] 開始處理 - 主公：${monarch} | 序號：${serial}`);

      try {
        const response = await fillAndSubmit(monarch, serial);
        successCount++;
        
        addLog(`✅ ${monarch} 成功使用 ${serial}`, 'success');
        addDebugLog(`[${taskIndex}/${totalTasks}] 成功 - 伺服器回應: ${JSON.stringify(response)}`);
      } catch (error) {
        errorCount++;
        
        const errorReason = error.message || '未知錯誤';
        addLog(`❌ ${monarch} 使用 ${serial} 失敗: ${errorReason}`, 'error');
        addDebugLog(`[${taskIndex}/${totalTasks}] 失敗 - ${error.message}`, error);
      }

      // 延遲
      if (taskIndex < totalTasks && !shouldStop) {
        await sleep(500); // 可以縮短延遲
      }
    }
  }

  // 完成
  updateProgress(100, '執行完成');
  addLog('========================================', 'info');
  addLog(`執行完成！成功：${successCount}，失敗：${errorCount}`, successCount > 0 ? 'success' : 'warning');
  autoExportLog();
  resetUI();
}

// 錯誤代碼轉換
function getErrorMessage(code) {
  const errorMap = {
    "0": "道具已發送。請於遊戲內信箱確認。",
    "11": "語言錯誤",
    "21": "服務器錯誤",
    "31": "主公名稱輸入錯誤。",
    "32": "該帳戶已退出",
    "72": "已使用過的虛寶序號。",
    "81": "無更多兌換碼",
    "82": "兌換碼過期",
    "84": "錯誤的虛寶序號。",
    "98": "Please access from the coupon page.",
    "99": "其他錯誤",
  };
  return errorMap[code] || `未知的錯誤代碼 (${code})`;
}


// 直接發送 POST 請求
async function fillAndSubmit(monarch, serial) {
  const url = 'https://coupon.kingdom-story.com/register-coupon';
  const body = new URLSearchParams({
    server: '10', // 天下爭霸
    monarch: monarch,
    serialcode: serial
  });

  try {
    addDebugLog(`發送請求至 ${url}`, { monarch, serial });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });

    if (!response.ok) {
      addDebugLog(`請求失敗，HTTP 狀態碼: ${response.status}`);
      throw new Error(`伺服器錯誤 (HTTP ${response.status})`);
    }

    const data = await response.json();
    addDebugLog('收到伺服器回應', data);

    if (data.code === 0) {
      return data; // 成功
    } else {
      throw new Error(getErrorMessage(data.code));
    }
  } catch (error) {
    addDebugLog(`請求捕獲到錯誤: ${error.message}`, error);
    // 如果是網路錯誤，error.message 會更通用
    if (error instanceof TypeError) {
        throw new Error('網路錯誤，無法連接到伺服器');
    }
    // 否則，拋出已處理的錯誤訊息
    throw error;
  }
}

// 更新進度
function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

// 添加詳細的 debug 日誌（不顯示在 UI）
function addDebugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
  debugLogs.push(logEntry);
  console.log('[DEBUG]', message, data || '');
}

// 添加日誌（顯示在 UI）
let saveTimeout = null;
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString('zh-TW');
  entry.textContent = `[${timestamp}] ${message}`;
  logContent.appendChild(entry);
  logContent.scrollTop = logContent.scrollHeight;
  
  // 同時記錄到 debug log
  addDebugLog(`[UI-${type.toUpperCase()}] ${message}`);
  
  // 防抖保存（500ms 內只保存一次）
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveState();
  }, 500);
}

// 重置 UI
function resetUI() {
  isRunning = false;
  startBtn.disabled = false;
  stopBtn.style.display = 'none';
}

// 延遲函數
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
