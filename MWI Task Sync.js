// ==UserScript==
// @name         MWI Task Sync (Shared Bin)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Sync Milky Way Idle task data to a shared jsonbin.io bin with manual upload support
// @match        https://*.milkywayidle.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';
  
    const API_KEY = "$2a$10$BuzVhO.zxHogPcYrZbMjfu4Mj3hDMuBjKBaFQSt2lGj7zS0bDmXny";
    const BIN_ID = "6809bdf78960c979a58be9d1";
    const MANUAL_UPLOAD_INTERVAL_MS = 60000;
    const ALLOWED_USERS = ['Saquon', 'ZyzzBraah', 'Medusaz'];

    const SELECTORS = {
      username: '[data-name]',
      taskSlotRow: '.TasksPanel_taskSlotCount__nfhgS',
      taskList: '[class*="TasksPanel_taskList"]',
      taskElements: '[class*="RandomTask_randomTask"]',
      taskName: '[class*="RandomTask_name"]',
      taskButton: '#mwi-manual-upload-btn',
      navTabs: '.NavigationBar_navigationLink__3eAHA',
      activeTab: 'NavigationBar_active__3R-QS',
      navMinorLinks: '.NavigationBar_minorNavigationLinks__dbxh7'
    };
  
    function getCurrentUsername() {
      return document.querySelector(SELECTORS.username)?.getAttribute('data-name') || null;
    }
  
    function extractSlotInfo() {
      const text = document.querySelector(SELECTORS.taskSlotRow)?.textContent;
      const match = text?.match(/(\d+)\s*\/\s*(\d+)/);
      return match ? { current: +match[1], max: +match[2] } : null;
    }
  
    function extractTasksFromBoard() {
      const list = document.querySelector(SELECTORS.taskList);
      if (!list) return [];
    
      return Array.from(list.querySelectorAll(SELECTORS.taskElements)).map(el => {
        const nameEl = el.querySelector(SELECTORS.taskName);
        let name = '';
        if (nameEl) {
          const textNode = Array.from(nameEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
          const zoneEl = nameEl.querySelector('.script_taskMapIndex');
          name = (textNode?.textContent.trim() || '') + (zoneEl ? ` ${zoneEl.textContent.trim()}` : '');
        }
    
        const [_, progress, total] = el.innerText.match(/Progress:\s*(\d+)\s*\/\s*(\d+)/) || [];
        const rewards = el.querySelectorAll('.Item_itemContainer__x7kH1');
    
        let gold = null, tokens = null;
        rewards.forEach(div => {
          const icon = div.querySelector('svg use')?.getAttribute('href') || '';
          const count = +div.querySelector('.Item_count__1HVvv')?.textContent.replace(/,/g, '') || 0;
          if (icon.includes('coin')) gold = count;
          if (icon.includes('task_token')) tokens = count;
        });
    
        return { name, progress: +progress, total: +total, gold, tokens };
      });
    }
    
  
    function areTasksSimilar(oldTasks, newTasks) {
      if (!oldTasks || oldTasks.length !== newTasks.length) return false;
      return !newTasks.some(task => {
        const match = oldTasks.find(t => t.name === task.name && t.total === task.total);
        if (!match) return true;
        return Math.abs((match.total - match.progress) - (task.total - task.progress)) >= task.total * 0.4;
      });
    }
  
    function getUploadCountKey(user) {
      return `uploadCount_${user}_${new Date().toISOString().slice(0, 13)}`;
    }
  
    function uploadToSharedBin(username, tasks, slots, isManual = false) {
      if (!ALLOWED_USERS.includes(username)) {
          console.warn(`[MWI Party Tasks] -- User "${username}" not allowed to upload.`);
          return;
      }
      const countKey = getUploadCountKey(username);
      const currentCount = GM_getValue(countKey, 0);
      const last = GM_getValue(`lastUpload_${username}`);
  
      if (currentCount >= 10) return console.warn(`[MWI Party Tasks] -- Hourly limit hit for ${username}`);
      if (areTasksSimilar(last?.tasks, tasks)) return console.log(`[MWI Party Tasks] -- No changes for ${username}`);
  
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,
        headers: { 'X-Master-Key': API_KEY },
        onload: res => {
          if (res.status !== 200) return console.error(`[MWI Party Tasks] -- GET failed (${res.status})`);
  
          let existing = {};
          try { existing = JSON.parse(res.responseText).record || {}; } catch (e) {}
  
          existing[username] = { user: username, timestamp: new Date().toISOString(), slots, tasks };
  
          GM_xmlhttpRequest({
            method: 'PUT',
            url: `https://api.jsonbin.io/v3/b/${BIN_ID}`,
            headers: {
              'Content-Type': 'application/json',
              'X-Master-Key': API_KEY,
              'X-Bin-Versioning': false
            },
            data: JSON.stringify(existing),
            onload: putRes => {
              if (putRes.status >= 200 && putRes.status < 300) {
                GM_setValue(`lastUpload_${username}`, { tasks });
                GM_setValue(countKey, currentCount + 1);
                if (isManual) GM_setValue(`lastManualUpload_${username}`, Date.now());
                console.log("[MWI Party Tasks] -- Tasks uploaded!")
              } else {
                console.warn(`[MWI Party Tasks] -- PUT error (${putRes.status})`, putRes.responseText);
              }
            },
            onerror: e => console.error('[MWI Party Tasks] -- PUT request error', e)
          });
        },
        onerror: e => console.error('[MWI Party Tasks] -- GET request error', e)
      });
    }
  
    function injectManualUploadButton() {
      const row = document.querySelector(SELECTORS.taskSlotRow);
      if (!row || document.querySelector(SELECTORS.taskButton)) return;
  
      const btn = document.createElement('button');
      btn.id = 'mwi-manual-upload-btn';
      btn.textContent = '⬆ Upload Tasks to Party ⬆';
      btn.className = 'Button_button__1Fe9z Button_small__3fqC7';
      btn.style.marginLeft = '6px';
  
      btn.onclick = () => {
        const username = getCurrentUsername();
        if (!username) return;
  
        const last = GM_getValue(`lastManualUpload_${username}`, 0);
        const now = Date.now();
  
        if (now - last < MANUAL_UPLOAD_INTERVAL_MS) {
          alert(`⛔ I'm on the free plan. Slow down! Try again in ${Math.ceil((MANUAL_UPLOAD_INTERVAL_MS - (now - last)) / 1000)}s.`);
          return;
        }
  
        const tasks = extractTasksFromBoard();
        const slots = extractSlotInfo();
        uploadToSharedBin(username, tasks, slots, true);
      };
  
      row.appendChild(btn);
    }
  
    function injectGitHubNavLink() {
      const nav = document.querySelector(SELECTORS.navMinorLinks);
      if (!nav || document.querySelector('#mwi-party-link')) return;
  
      const link = document.createElement('div');
      link.id = 'mwi-party-link';
      link.className = 'NavigationBar_minorNavigationLink__31K7Y';
      link.style.color = 'orange';
      link.style.cursor = 'pointer';
      link.textContent = 'Party Tasks Dashboard';
      link.onclick = () => window.open('https://probably-bagel.github.io/MWI-Party-Tasks/', '_blank');
  
      nav.insertBefore(link, nav.firstChild);
    }
  
    function setupTasksTabObserver() {
      const observer = new MutationObserver(() => {
        const tasksTabActive = Array.from(document.querySelectorAll(SELECTORS.navTabs))
          .some(link => link.classList.contains(SELECTORS.activeTab) && link.textContent.includes('Tasks'));
        const username = getCurrentUsername();
        const slotRow = document.querySelector(SELECTORS.taskSlotRow);
        if (tasksTabActive && slotRow && !document.querySelector(SELECTORS.taskButton) && ALLOWED_USERS.includes(username)){
  
          injectManualUploadButton();

          if (!username) return;
  
          const taskList = document.querySelector(SELECTORS.taskList);
          if (taskList) {
            const tasks = extractTasksFromBoard();
            const slots = extractSlotInfo();
            uploadToSharedBin(username, tasks, slots);
          }
        }
      });
  
      observer.observe(document.body, { childList: true, subtree: true });
    }
  
    window.addEventListener('load', () => {
      setTimeout(injectGitHubNavLink, 1000); // Delay to ensure nav element is mounted
    });
    setupTasksTabObserver();
  })();
  