const API = 'https://sample-api-1-ryj7.onrender.com';
const BRIDGE_URL = 'https://teleagent-whatsapp.onrender.com';

let token = localStorage.getItem('ta_token');
let sessionId = localStorage.getItem('ta_session_id');
let phoneCodeHash = null, currentPhone = null;
let currentInboxType = 'saved';
let waStatusCheckInterval = null;
let tgConnected = false;
let waConnected = false;
let userWhatsAppPhone = null;
let botConfigured = false;

// Loading state
function showLoading(text = 'Processing...') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

function showModal(id) {
  document.getElementById(id).classList.add('show');
}

// Get user's WhatsApp phone from session
async function getUserWhatsAppPhone() {
  if (!token) return null;
  try {
    const res = await fetch(`${API}/api/ta/whatsapp/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data.whatsapp_phone || null;
  } catch (e) {
    return null;
  }
}

// Bot status
async function loadBotStatus() {
  if (!token) return;
  
  try {
    const res = await fetch(`${API}/api/ta/whatsapp/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    
    const dot = document.getElementById('botStatusDot');
    const text = document.getElementById('botStatusText');
    const detail = document.getElementById('botDetail');
    const btn = document.getElementById('botActionBtn');
    
    if (data.success && data.config.bot_token) {
      botConfigured = true;
      dot.className = 'status-dot online';
      text.textContent = 'Active';
      detail.textContent = 'Reply buttons enabled';
      btn.textContent = 'Change';
    } else {
      botConfigured = false;
      dot.className = 'status-dot offline';
      text.textContent = 'Not configured';
      detail.textContent = 'Add bot token for reply buttons';
      btn.textContent = 'Configure';
    }
  } catch (e) {
    console.error('Bot status error:', e);
  }
}

function showBotSetup() {
  document.getElementById('botInstructions').style.display = 'block';
  document.getElementById('botTokenInput').value = '';
  document.getElementById('botTokenStatus').innerHTML = '';
  
  // Show/hide remove button
  const removeBtn = document.getElementById('removeBotBtn');
  removeBtn.style.display = botConfigured ? 'block' : 'none';
  
  showModal('botModal');
}

async function saveBotToken() {
  const botToken = document.getElementById('botTokenInput').value.trim();
  if (!botToken) {
    toast('Enter bot token', 'error');
    return;
  }
  
  if (!botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    toast('Invalid bot token format', 'error');
    return;
  }
  
  showLoading('Connecting bot...');
  
  try {
    const res = await fetch(`${API}/api/ta/agent/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bot_token: botToken })
    });
    
    const data = await res.json();
    
    if (data.success) {
      closeModal('botModal');
      document.getElementById('botInstructions').style.display = 'none';
      await loadBotStatus();
      toast('Bot connected! Reply buttons now enabled ✅');
      
      if (currentInboxType === 'group') {
        setTimeout(() => {
          toast('⚠️ Dont forget to add your bot to the group!', 'success');
        }, 2000);
      }
    } else {
      document.getElementById('botTokenStatus').innerHTML = 
        `<p style="color: var(--danger); font-size: 13px;">❌ ${data.error || 'Failed to connect bot'}</p>`;
    }
  } catch (e) {
    document.getElementById('botTokenStatus').innerHTML = 
      `<p style="color: var(--danger); font-size: 13px;">❌ Connection error</p>`;
  }
  
  hideLoading();
}

async function removeBotToken() {
  if (!confirm('Remove bot token? Reply buttons will stop working.')) return;
  
  showLoading('Removing bot...');
  
  try {
    await fetch(`${API}/api/ta/agent/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bot_token: null })
    });
    
    closeModal('botModal');
    document.getElementById('botInstructions').style.display = 'none';
    await loadBotStatus();
    toast('Bot removed');
  } catch (e) {
    toast('Failed to remove bot', 'error');
  }
  
  hideLoading();
}

// Load all statuses
async function loadAllStatus() {
  if (!token || !sessionId) {
    updateTelegramUI(null);
    updateWhatsAppUI(null);
    updateGitHubUI(null);
    return;
  }
  
  userWhatsAppPhone = await getUserWhatsAppPhone();
  
  try {
    const res = await fetch(`${API}/api/ta/agent/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    updateTelegramUI(data);
  } catch (e) {}
  
  try {
    const res = await fetch(`${BRIDGE_URL}/status`);
    const data = await res.json();
    
    let waStatus = { connected: false };
    
    if (data.sessions && userWhatsAppPhone) {
      const cleanUserPhone = userWhatsAppPhone.replace(/\D/g, '');
      const mySession = data.sessions.find(s => {
        const cleanSessionPhone = s.phone.replace(/\D/g, '');
        return cleanSessionPhone === cleanUserPhone;
      });
      waStatus = mySession || { connected: false };
    } else if (data.connected !== undefined) {
      waStatus = data;
    }
    
    updateWhatsAppUI(waStatus);
    
    const configRes = await fetch(`${API}/api/ta/whatsapp/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const configData = await configRes.json();
    if (configData.success) {
      const target = configData.config.forward_target;
      const inboxDetail = document.getElementById('inboxDetail');
      if (target) {
        inboxDetail.textContent = `Forwarding to ${target}`;
        currentInboxType = 'group';
      } else {
        inboxDetail.textContent = 'Messages go to Saved Messages';
        currentInboxType = 'saved';
      }
      document.getElementById('inboxCard').style.display = waConnected ? 'flex' : 'none';
    }
  } catch (e) {}
  
  try {
    const res = await fetch(`${API}/api/ta/github/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    updateGitHubUI(data);
  } catch (e) {}
  
  await loadBotStatus();
}

function updateTelegramUI(data) {
  const dot = document.getElementById('tgStatusDot');
  const text = document.getElementById('tgStatusText');
  const detail = document.getElementById('tgDetail');
  const actionBtn = document.getElementById('tgActionBtn');
  const disconnectBtn = document.getElementById('tgDisconnectBtn');
  const card = document.getElementById('telegramCard');
  
  if (data && data.is_running) {
    tgConnected = true;
    dot.className = 'status-dot online';
    text.textContent = 'Active';
    detail.textContent = `${data.session.agent_name || 'Agent'} · ${data.session.phone || ''}`;
    actionBtn.textContent = 'Stop';
    actionBtn.className = 'btn btn-small btn-outline';
    actionBtn.onclick = () => stopAgent();
    disconnectBtn.style.display = 'inline-block';
    card.classList.add('connected');
  } else if (data && data.session) {
    tgConnected = false;
    dot.className = 'status-dot warning';
    text.textContent = 'Inactive';
    detail.textContent = data.session.phone || 'Tap to start';
    actionBtn.textContent = 'Start';
    actionBtn.className = 'btn btn-small btn-primary';
    actionBtn.onclick = () => startAgent();
    disconnectBtn.style.display = 'inline-block';
    card.classList.remove('connected');
  } else {
    tgConnected = false;
    dot.className = 'status-dot offline';
    text.textContent = 'Not connected';
    detail.textContent = 'Tap to connect';
    actionBtn.textContent = 'Connect';
    actionBtn.className = 'btn btn-small';
    actionBtn.onclick = () => showTelegramSetup();
    disconnectBtn.style.display = 'none';
    card.classList.remove('connected');
  }
}

function updateWhatsAppUI(data) {
  const dot = document.getElementById('waStatusDot');
  const text = document.getElementById('waStatusText');
  const detail = document.getElementById('waDetail');
  const actionBtn = document.getElementById('waActionBtn');
  const disconnectBtn = document.getElementById('waDisconnectBtn');
  const changeBtn = document.getElementById('waChangeBtn');
  const card = document.getElementById('whatsappCard');
  
  if (data && data.connected) {
    waConnected = true;
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
    detail.textContent = 'WhatsApp is active';
    actionBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-block';
    changeBtn.style.display = 'inline-block';
    card.classList.add('connected');
    document.getElementById('inboxCard').style.display = 'flex';
  } else {
    waConnected = false;
    dot.className = 'status-dot offline';
    text.textContent = 'Not connected';
    detail.textContent = 'Tap to connect';
    actionBtn.style.display = 'inline-block';
    actionBtn.textContent = 'Connect';
    actionBtn.className = 'btn btn-small';
    disconnectBtn.style.display = 'none';
    changeBtn.style.display = 'none';
    card.classList.remove('connected');
    document.getElementById('inboxCard').style.display = 'none';
  }
}

function updateGitHubUI(data) {
  const dot = document.getElementById('ghStatusDot');
  const text = document.getElementById('ghStatusText');
  const detail = document.getElementById('ghDetail');
  const btn = document.getElementById('ghActionBtn');
  const card = document.getElementById('githubCard');
  
  if (data && data.connected) {
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
    detail.textContent = `@${data.username} · ${data.repo_count} repos`;
    btn.textContent = 'Connected';
    btn.className = 'btn btn-small btn-success';
    btn.onclick = null;
    card.classList.add('connected');
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Not connected';
    detail.textContent = 'Connect to deploy sites';
    btn.textContent = 'Connect';
    btn.className = 'btn btn-small';
    btn.onclick = () => connectGithub();
    card.classList.remove('connected');
  }
}

// Telegram Actions
function handleTelegramAction() {
  if (tgConnected) {
    stopAgent();
  } else {
    showTelegramSetup();
  }
}

function showTelegramSetup() {
  document.getElementById('tgStep1').style.display = 'block';
  document.getElementById('tgStep2').style.display = 'none';
  document.getElementById('tgStep3').style.display = 'none';
  document.getElementById('modalTitle').textContent = 'Connect Telegram';
  document.getElementById('phoneInput').value = '';
  document.getElementById('codeInput').value = '';
  showModal('telegramModal');
}

async function sendCode() {
  const phone = document.getElementById('phoneInput').value.trim();
  if (!phone) { toast('Enter phone number', 'error'); return; }
  
  showLoading('Sending code...');
  try {
    const res = await fetch(`${API}/api/ta/telegram/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.success) {
      phoneCodeHash = data.phone_code_hash;
      currentPhone = phone;
      document.getElementById('tgStep1').style.display = 'none';
      document.getElementById('tgStep2').style.display = 'block';
      document.getElementById('modalTitle').textContent = 'Enter Code';
      toast('Code sent to Telegram');
    } else {
      toast(data.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
  hideLoading();
}

function backToPhone() {
  document.getElementById('tgStep1').style.display = 'block';
  document.getElementById('tgStep2').style.display = 'none';
  document.getElementById('twoFAGroup').style.display = 'none';
  document.getElementById('modalTitle').textContent = 'Connect Telegram';
}

async function verifyCode() {
  const code = document.getElementById('codeInput').value.trim();
  const twoFA = document.getElementById('twoFAInput').value.trim();
  if (!code) { toast('Enter code', 'error'); return; }
  
  showLoading('Verifying...');
  try {
    const body = { phone: currentPhone, code, phone_code_hash: phoneCodeHash };
    if (twoFA) body.password = twoFA;
    
    const res = await fetch(`${API}/api/ta/telegram/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    
    if (data.success) {
      token = data.token;
      sessionId = data.session_id;
      localStorage.setItem('ta_token', token);
      localStorage.setItem('ta_session_id', sessionId);
      
      document.getElementById('tgStep2').style.display = 'none';
      document.getElementById('tgStep3').style.display = 'block';
      document.getElementById('modalTitle').textContent = 'Setup Your Agent';
      toast(`Welcome ${data.tg_name}!`);
    } else if (data.error === '2FA_REQUIRED') {
      document.getElementById('twoFAGroup').style.display = 'block';
      toast('Enter 2FA password', 'error');
    } else {
      toast(data.error || 'Invalid code', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
  hideLoading();
}

async function finishTelegramSetup() {
  const agentName = document.getElementById('agentName').value.trim() || 'TeleAgent';
  const userName = document.getElementById('userName').value.trim() || 'Boss';
  const platformName = document.getElementById('platformName').value.trim();
  
  showLoading('Launching agent...');
  try {
    await fetch(`${API}/api/ta/agent/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        agent_nickname: agentName,
        user_nickname: userName,
        platform_name: platformName
      })
    });
    
    closeModal('telegramModal');
    await loadAllStatus();
    toast(`${agentName} is live! 🚀`);
  } catch (e) {
    toast('Setup failed', 'error');
  }
  hideLoading();
}

async function startAgent() {
  showLoading('Starting agent...');
  try {
    await fetch(`${API}/api/ta/agent/start`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await loadAllStatus();
    toast('Agent started');
  } catch (e) {
    toast('Failed to start', 'error');
  }
  hideLoading();
}

async function stopAgent() {
  showLoading('Stopping agent...');
  try {
    await fetch(`${API}/api/ta/agent/stop`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await loadAllStatus();
    toast('Agent stopped');
  } catch (e) {
    toast('Failed to stop', 'error');
  }
  hideLoading();
}

async function disconnectTelegram() {
  if (!confirm('Disconnect Telegram? This will stop your agent.')) return;
  
  showLoading('Disconnecting...');
  try {
    await fetch(`${API}/api/ta/agent/disconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    localStorage.removeItem('ta_token');
    localStorage.removeItem('ta_session_id');
    token = null;
    sessionId = null;
    tgConnected = false;
    userWhatsAppPhone = null;
    await loadAllStatus();
    toast('Telegram disconnected');
  } catch (e) {
    toast('Failed to disconnect', 'error');
  }
  hideLoading();
}

// WhatsApp Actions
function handleWhatsAppAction() {
  if (!token) {
    toast('Connect Telegram first', 'error');
    return;
  }
  showWhatsAppSetup();
}

function showWhatsAppSetup(isChange = false) {
  document.getElementById('waModalTitle').textContent = isChange ? 'Change WhatsApp Number' : 'Connect WhatsApp';
  document.getElementById('waStep1').style.display = 'block';
  document.getElementById('waStep2').style.display = 'none';
  document.getElementById('waPhoneInput').value = '';
  showModal('whatsappModal');
}

function changeWhatsAppNumber() {
  showWhatsAppSetup(true);
}

async function requestPairingCode() {
  const phone = document.getElementById('waPhoneInput').value.trim();
  if (!phone) { toast('Enter phone number', 'error'); return; }
  
  showLoading('Requesting pairing code...');
  try {
    const res = await fetch(`${API}/api/ta/whatsapp/pair`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ phone_number: phone, phone: phone })
    });
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('waStep1').style.display = 'none';
      document.getElementById('waStep2').style.display = 'block';
      document.getElementById('pairingCodeDisplay').textContent = data.code.match(/.{1,4}/g)?.join('-') || data.code;
      
      const pairingPhone = phone.replace(/\D/g, '');
      
      waStatusCheckInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${BRIDGE_URL}/status`);
          const statusData = await statusRes.json();
          
          let isConnected = false;
          if (statusData.sessions) {
            const mySession = statusData.sessions.find(s => s.phone === pairingPhone);
            isConnected = mySession?.connected || false;
          } else {
            isConnected = statusData.connected || false;
          }
          
          if (isConnected) {
            clearInterval(waStatusCheckInterval);
            document.getElementById('waConnectingSpinner').style.display = 'none';
            document.getElementById('waConnectingText').textContent = 'Connected! ✅';
            userWhatsAppPhone = pairingPhone;
            await loadAllStatus();
            toast('WhatsApp connected!');
          }
        } catch (e) {}
      }, 2000);
    } else {
      toast(data.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Connection error', 'error');
  }
  hideLoading();
}

function closeWhatsAppAndRefresh() {
  if (waStatusCheckInterval) clearInterval(waStatusCheckInterval);
  closeModal('whatsappModal');
  loadAllStatus();
}

async function disconnectWhatsApp() {
  if (!confirm('Disconnect WhatsApp? Messages will no longer be forwarded.')) return;
  
  showLoading('Disconnecting WhatsApp...');
  try {
    await fetch(`${API}/api/ta/whatsapp/disconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    waConnected = false;
    userWhatsAppPhone = null;
    await loadAllStatus();
    toast('WhatsApp disconnected');
  } catch (e) {
    toast('Failed to disconnect', 'error');
  }
  hideLoading();
}

// GitHub
function handleGithubAction() {
  connectGithub();
}

async function connectGithub() {
  if (!token) { toast('Connect Telegram first', 'error'); return; }
  try {
    const res = await fetch(`${API}/api/ta/github/connect`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  } catch (e) {
    toast('Failed', 'error');
  }
}

// Inbox
function showInboxSelector() {
  document.getElementById('inboxSaved').classList.toggle('active', currentInboxType === 'saved');
  document.getElementById('inboxGroup').classList.toggle('active', currentInboxType === 'group');
  document.getElementById('groupInputWrapper').style.display = currentInboxType === 'group' ? 'block' : 'none';
  showModal('inboxModal');
}

function selectInbox(type) {
  currentInboxType = type;
  document.getElementById('inboxSaved').classList.toggle('active', type === 'saved');
  document.getElementById('inboxGroup').classList.toggle('active', type === 'group');
  document.getElementById('groupInputWrapper').style.display = type === 'group' ? 'block' : 'none';
}

async function saveInboxSettings() {
  const target = currentInboxType === 'group' ? document.getElementById('groupUsername').value.trim() : null;
  
  showLoading('Saving...');
  try {
    await fetch(`${API}/api/ta/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ forward_target: target || null })
    });
    
    closeModal('inboxModal');
    await loadAllStatus();
    toast(target ? `Messages go to ${target}` : 'Messages go to Saved Messages');
    
    if (currentInboxType === 'group' && !botConfigured) {
      setTimeout(() => {
        toast('💡 Add a bot token to enable reply buttons in groups!', 'success');
      }, 1000);
    }
  } catch (e) {
    toast('Failed to save', 'error');
  }
  hideLoading();
}

// Init
window.addEventListener('load', async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('github') === 'connected') {
    window.history.replaceState({}, '', '/');
    toast(`GitHub connected as @${params.get('username')}`, 'success');
  }
  
  await loadAllStatus();
  setInterval(loadAllStatus, 30000);
});
