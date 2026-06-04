// 全域變數
let monarchs = [];
let serials = [];
let isRunning = false;
let shouldStop = false;

// DOM 元素
const monarchFile = document.getElementById('monarchFile');
const serialFile = document.getElementById('serialFile');
const monarchFileName = document.getElementById('monarchFileName');
const serialFileName = document.getElementById('serialFileName');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logSection = document.getElementById('logSection');
const logContent = document.getElementById('logContent');

// 文件上傳處理
monarchFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    monarchFileName.textContent = file.name;
    readFile(file, (content) => {
      monarchs = content.split('\n').map(line => line.trim()).filter(line => line);
      checkFilesReady();
      addLog(`已載入 ${monarchs.length} 個主公名稱`, 'info');
    });
  }
});

serialFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    serialFileName.textContent = file.name;
    readFile(file, (content) => {
      serials = content.split('\n').map(line => line.trim()).filter(line => line);
      checkFilesReady();
      addLog(`已載入 ${serials.length} 個虛寶序號`, 'info');
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

  addLog('🚀 開始執行自動填寫...', 'info');
  addLog(`模式：${mode === 'oneToOne' ? '一對一' : '共用'}`, 'info');
  addLog(`伺服器：天下爭霸`, 'info');

  // 獲取當前活動標籤頁
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) {
    addLog('錯誤：無法獲取當前標籤頁', 'error');
    resetUI();
    return;
  }
  
  addLog(`當前頁面：${tab.url}`, 'info');
  
  // 先檢查頁面結構
  addLog('🔍 正在檢查頁面結構...', 'info');
  try {
    const pageCheckResult = await checkPageStructure(tab.id);
    if (pageCheckResult.success) {
      addLog('✓ 頁面結構檢查完成', 'success');
      addLog(`詳細資訊：`, 'info');
      const pageInfo = pageCheckResult.pageInfo;
      addLog(`  - 伺服器輸入框: ${pageInfo.elements.serverInput.found ? '✓' : '✗'}`, pageInfo.elements.serverInput.found ? 'success' : 'error');
      addLog(`  - 主公名稱輸入框: ${pageInfo.elements.monarchInput.found ? '✓' : '✗'}`, pageInfo.elements.monarchInput.found ? 'success' : 'error');
      addLog(`  - 虛寶序號輸入框: ${pageInfo.elements.serialInput.found ? '✓' : '✗'}`, pageInfo.elements.serialInput.found ? 'success' : 'error');
      addLog(`  - 提交按鈕: ${pageInfo.elements.submitButton.jsSubmitBtn || pageInfo.elements.submitButton.serialFormSubmit ? '✓' : '✗'}`, 
             pageInfo.elements.submitButton.jsSubmitBtn || pageInfo.elements.submitButton.serialFormSubmit ? 'success' : 'error');
    }
  } catch (error) {
    addLog(`⚠ 頁面檢查失敗: ${error.message}`, 'warning');
  }

  // 執行任務
  if (mode === 'oneToOne') {
    await executeOneToOne(tab.id);
  } else {
    await executeShared(tab.id);
  }
});

// 停止執行
stopBtn.addEventListener('click', () => {
  shouldStop = true;
  addLog('正在停止執行...', 'warning');
});

// 一對一模式
async function executeOneToOne(tabId) {
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
    addLog(`[${i + 1}/${total}] 主公：${monarch} | 序號：${serial}`, 'info');

    try {
      await fillAndSubmit(tabId, monarch, serial);
      successCount++;
      addLog(`✓ 成功提交`, 'success');
    } catch (error) {
      errorCount++;
      addLog(`✗ 錯誤：${error.message}`, 'error');
    }

    // 延遲 2 秒
    if (i < total - 1 && !shouldStop) {
      await sleep(2000);
    }
  }

  // 完成
  updateProgress(100, '執行完成');
  addLog('========================================', 'info');
  addLog(`執行完成！成功：${successCount}，失敗：${errorCount}`, successCount > 0 ? 'success' : 'warning');
  resetUI();
}

// 共用模式
async function executeShared(tabId) {
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
    addLog(`======== 使用序號：${serial} ========`, 'info');

    for (let m = 0; m < monarchs.length; m++) {
      if (shouldStop) break;

      const monarch = monarchs[m];
      taskIndex++;
      const progress = (taskIndex / totalTasks * 100).toFixed(1);

      updateProgress(progress, `處理中 ${taskIndex}/${totalTasks}`);
      addLog(`[${taskIndex}/${totalTasks}] 主公：${monarch}`, 'info');

      try {
        await fillAndSubmit(tabId, monarch, serial);
        successCount++;
        addLog(`✓ 成功提交`, 'success');
      } catch (error) {
        errorCount++;
        addLog(`✗ 錯誤：${error.message}`, 'error');
      }

      // 延遲 2 秒
      if (taskIndex < totalTasks && !shouldStop) {
        await sleep(2000);
      }
    }
  }

  // 完成
  updateProgress(100, '執行完成');
  addLog('========================================', 'info');
  addLog(`執行完成！成功：${successCount}，失敗：${errorCount}`, successCount > 0 ? 'success' : 'warning');
  resetUI();
}

// 檢查頁面結構
async function checkPageStructure(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: 'checkPage' },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('無法與頁面通訊: ' + chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error('頁面檢查失敗'));
        }
      }
    );
  });
}

// 填寫並提交表單
async function fillAndSubmit(tabId, monarch, serial) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        action: 'fillForm',
        monarch: monarch,
        serial: serial,
        server: '10' // 天下爭霸
      },
      (response) => {
        if (chrome.runtime.lastError) {
          // 檢查是否是本地文件權限問題
          const errorMsg = chrome.runtime.lastError.message || '';
          addLog(`Chrome 錯誤: ${errorMsg}`, 'error');
          if (errorMsg.includes('Cannot access') || errorMsg.includes('Receiving end does not exist')) {
            reject(new Error('無法與頁面通訊。如果您在測試本地文件，請到 chrome://extensions/ 啟用「允許存取檔案網址」'));
          } else {
            reject(new Error('無法與頁面通訊，請確保在正確的網頁上'));
          }
        } else if (response && response.success) {
          // 顯示執行日誌
          if (response.log && response.log.length > 0) {
            response.log.forEach(log => addLog(`  ${log}`, 'info'));
          }
          // 顯示網站回應
          if (response.response) {
            if (response.response.code === 0) {
              addLog(`  ✅ 網站確認成功`, 'success');
            } else if (response.response.code) {
              addLog(`  ⚠️ 網站回應: code ${response.response.code}`, 'warning');
            }
          }
          resolve();
        } else {
          // 顯示錯誤日誌
          if (response && response.log && response.log.length > 0) {
            response.log.forEach(log => addLog(`  ${log}`, 'error'));
          }
          // 檢查是否有錯誤代碼
          const errorMsg = response?.error || '未知錯誤';
          if (response && response.response && response.response.code) {
            addLog(`  ❌ 網站錯誤代碼: ${response.response.code}`, 'error');
          }
          reject(new Error(errorMsg));
        }
      }
    );
  });
}

// 更新進度
function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

// 添加日誌
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString('zh-TW');
  entry.textContent = `[${timestamp}] ${message}`;
  logContent.appendChild(entry);
  logContent.scrollTop = logContent.scrollHeight;
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
