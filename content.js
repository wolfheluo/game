// Content Script - 注入到網頁中執行

// LOG 系統
const LOG_PREFIX = '[虛寶插件]';
let lastResponse = null; // 儲存最後一次的回應

function log(message, data = null) {
  console.log(`${LOG_PREFIX} ${message}`, data || '');
}

function logError(message, error = null) {
  console.error(`${LOG_PREFIX} ❌ ${message}`, error || '');
}

function logSuccess(message, data = null) {
  console.log(`${LOG_PREFIX} ✅ ${message}`, data || '');
}

// 錯誤代碼對照表（根據常見情況）
const ERROR_CODES = {
  31: '序號無效或已使用（請確認序號正確、主公名稱存在、伺服器選擇正確）',
  // 可以繼續添加其他錯誤代碼
};

function getErrorMessage(code) {
  return ERROR_CODES[code] || `未知錯誤代碼: ${code}`;
}

// 監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('收到訊息', request);
  
  if (request.action === 'fillForm') {
    (async () => {
      try {
        log('開始填寫表單', { monarch: request.monarch, serial: request.serial, server: request.server });
        const result = await fillFormAndSubmit(request.monarch, request.serial, request.server);
        logSuccess('表單填寫完成');
        sendResponse({ success: true, log: result.log, response: result.response });
      } catch (error) {
        logError('表單填寫失敗', error);
        sendResponse({ success: false, error: error.message, log: error.log || [], response: lastResponse });
      }
    })();
    return true; // 保持訊息通道開啟
  }
  
  if (request.action === 'checkPage') {
    // 檢查頁面結構
    const pageInfo = analyzePage();
    log('頁面分析結果', pageInfo);
    sendResponse({ success: true, pageInfo });
    return true;
  }
  
  if (request.action === 'getLastResponse') {
    // 獲取最後一次回應
    sendResponse({ success: true, response: lastResponse });
    return true;
  }
});

// 分析頁面結構
function analyzePage() {
  const analysis = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    elements: {}
  };
  
  // 檢查伺服器選擇
  const serverInput = document.querySelector('input[name="server"]');
  const serverInput2 = document.querySelector('.js-selected-server');
  analysis.elements.serverInput = {
    found: !!serverInput,
    selector: 'input[name="server"]',
    className: serverInput?.className || 'N/A'
  };
  analysis.elements.serverInput2 = {
    found: !!serverInput2,
    selector: '.js-selected-server'
  };
  
  // 檢查主公名稱
  const monarchInput = document.querySelector('input[name="monarch"]');
  analysis.elements.monarchInput = {
    found: !!monarchInput,
    selector: 'input[name="monarch"]',
    className: monarchInput?.className || 'N/A',
    placeholder: monarchInput?.placeholder || 'N/A'
  };
  
  // 檢查虛寶序號
  const serialInput = document.querySelector('input[name="serialcode"]');
  analysis.elements.serialInput = {
    found: !!serialInput,
    selector: 'input[name="serialcode"]',
    className: serialInput?.className || 'N/A',
    placeholder: serialInput?.placeholder || 'N/A'
  };
  
  // 檢查提交按鈕
  const submitBtn1 = document.querySelector('.js-submit-btn');
  const submitBtn2 = document.querySelector('button.serialForm__submit');
  const submitBtn3 = document.querySelector('button[type="button"]');
  analysis.elements.submitButton = {
    jsSubmitBtn: !!submitBtn1,
    serialFormSubmit: !!submitBtn2,
    buttonTypeButton: !!submitBtn3,
    text: submitBtn1?.textContent || submitBtn2?.textContent || submitBtn3?.textContent || 'N/A'
  };
  
  // 檢查表單
  const form = document.querySelector('.serialForm, .js-serial-form');
  analysis.elements.form = {
    found: !!form,
    className: form?.className || 'N/A'
  };
  
  return analysis;
}

// 填寫表單並提交
async function fillFormAndSubmit(monarch, serial, serverValue) {
  const logs = [];
  
  try {
    logs.push('步驟 1: 分析頁面');
    const pageInfo = analyzePage();
    logs.push(`頁面 URL: ${pageInfo.url}`);
    
    // 1. 選擇伺服器
    logs.push('步驟 2: 查找伺服器選擇元素');
    const serverInput = document.querySelector('input[name="server"].js-selected-server') || 
                        document.querySelector('input[name="server"]') ||
                        document.querySelector('.js-selected-server');
    const serverList = document.querySelector('ul.js-select-form[data-type="server"]') ||
                       document.querySelector('ul[data-type="server"]');
    
    if (!serverInput) {
      const error = new Error('找不到伺服器輸入框');
      error.log = [...logs, `嘗試的選擇器: input[name="server"].js-selected-server, input[name="server"], .js-selected-server`];
      throw error;
    }
    logs.push(`✓ 找到伺服器輸入框: ${serverInput.className}`);
    
    if (!serverList) {
      logs.push('⚠ 找不到伺服器列表，直接設置值');
    } else {
      logs.push(`✓ 找到伺服器列表`);
    }

    // 設置伺服器值
    logs.push(`步驟 3: 設置伺服器值為 ${serverValue}`);
    serverInput.value = serverValue;
    
    // 找到對應的選項並觸發點擊（模擬用戶選擇）
    if (serverList) {
      const serverOption = serverList.querySelector(`li[data-value="${serverValue}"]`);
      if (serverOption) {
        logs.push(`✓ 找到伺服器選項: ${serverOption.textContent.trim()}`);
        const selectedText = serverList.querySelector('.js-selected-text');
        if (selectedText) {
          selectedText.textContent = serverOption.textContent.trim();
          logs.push('✓ 更新伺服器顯示文字');
        }
      }
    }

    // 2. 填入主公名稱
    logs.push('步驟 4: 填入主公名稱');
    const monarchInput = document.querySelector('input[name="monarch"]');
    if (!monarchInput) {
      const error = new Error('找不到主公名稱輸入框');
      error.log = [...logs, `嘗試的選擇器: input[name="monarch"]`];
      throw error;
    }
    logs.push(`✓ 找到主公名稱輸入框: ${monarchInput.className}`);
    
    monarchInput.value = monarch;
    monarchInput.dispatchEvent(new Event('input', { bubbles: true }));
    monarchInput.dispatchEvent(new Event('change', { bubbles: true }));
    logs.push(`✓ 已填入主公名稱: ${monarch}`);

    // 3. 填入虛寶序號
    logs.push('步驟 5: 填入虛寶序號');
    const serialInput = document.querySelector('input[name="serialcode"]');
    if (!serialInput) {
      const error = new Error('找不到虛寶序號輸入框');
      error.log = [...logs, `嘗試的選擇器: input[name="serialcode"]`];
      throw error;
    }
    logs.push(`✓ 找到虛寶序號輸入框: ${serialInput.className}`);
    
    serialInput.value = serial;
    serialInput.dispatchEvent(new Event('input', { bubbles: true }));
    serialInput.dispatchEvent(new Event('change', { bubbles: true }));
    logs.push(`✓ 已填入虛寶序號: ${serial}`);

    // 4. 設置回應監聽器
    logs.push('步驟 6: 設置回應監聽器');
    const responsePromise = waitForResponse();

    // 5. 等待一小段時間確保表單更新
    await new Promise(resolve => setTimeout(resolve, 300));
    
    logs.push('步驟 7: 點擊提交按鈕');
    const submitBtn = document.querySelector('button.js-submit-btn') || 
                      document.querySelector('button.serialForm__submit') ||
                      document.querySelector('.serialForm__submit');
    if (!submitBtn) {
      const error = new Error('找不到提交按鈕');
      error.log = [...logs, `嘗試的選擇器: button.js-submit-btn, button.serialForm__submit, .serialForm__submit`];
      throw error;
    }
    logs.push(`✓ 找到提交按鈕: ${submitBtn.textContent.trim()}`);

    if (submitBtn.disabled) {
      logs.push('⚠ 按鈕被禁用，嘗試啟用');
      submitBtn.disabled = false;
    }
    
    submitBtn.click();
    logs.push('✓ 已點擊提交按鈕');
    
    // 等待回應（3 秒超時）
    logs.push('步驟 8: 等待網站回應...');
    const response = await Promise.race([
      responsePromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('等待回應超時')), 3000)
      )
    ]).catch(err => {
      logs.push(`⚠ ${err.message}`);
      return null;
    });
    
    if (response) {
      logs.push(`✓ 收到網站回應: ${JSON.stringify(response)}`);
      
      if (response.code && response.code !== 0) {
        const errorMsg = getErrorMessage(response.code);
        logs.push(`❌ 網站返回錯誤代碼 ${response.code}: ${errorMsg}`);
        const error = new Error(`網站錯誤 (code: ${response.code}): ${errorMsg}`);
        error.log = logs;
        error.code = response.code;
        throw error;
      } else {
        logs.push('✅ 提交成功！');
      }
    } else {
      logs.push('⚠ 未收到明確回應，但表單已提交');
    }
    
    logSuccess('表單已提交', { logs });
    return { success: true, log: logs, response };
    
  } catch (error) {
    error.log = logs;
    throw error;
  }
}

// 等待網站回應
function waitForResponse() {
  return new Promise((resolve) => {
    // 監聽 console.log 來捕捉 serialcode.js 的輸出
    const originalLog = console.log;
    const checkResponse = (...args) => {
      originalLog.apply(console, args);
      
      // 檢查是否是 result 對象
      if (args[0] === 'result' && args[1] && typeof args[1] === 'object' && 'code' in args[1]) {
        lastResponse = args[1];
        log('📡 捕捉到網站回應', args[1]);
        console.log = originalLog; // 恢復
        resolve(args[1]);
      }
    };
    
    console.log = checkResponse;
    
    // 3 秒後自動恢復
    setTimeout(() => {
      console.log = originalLog;
    }, 3000);
  });
}

// 頁面載入時的初始化
log('🎮 三國萌萌打虛寶序號自動填寫工具已載入');
log('頁面 URL: ' + window.location.href);

// 自動分析頁面
setTimeout(() => {
  const pageInfo = analyzePage();
  log('📊 頁面結構分析', pageInfo);
}, 1000);
