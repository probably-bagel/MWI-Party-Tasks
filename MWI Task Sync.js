// ==UserScript==
// @name         MWI Task Sync (Firebase Version)
// @namespace    http://tampermonkey.net/
// @version      2.11
// @description  Upload Milky Way Idle task data to Firebase Realtime Database
// @match        https://*.milkywayidle.com/*
// @updateURL    https://raw.githubusercontent.com/probably-bagel/MWI-Party-Tasks/refs/heads/main/MWI%20Task%20Sync.js
// @downloadURL  https://raw.githubusercontent.com/probably-bagel/MWI-Party-Tasks/refs/heads/main/MWI%20Task%20Sync.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const DATABASE_URL = 'https://milky-way-idle-party-tools-default-rtdb.firebaseio.com';
  const MANUAL_UPLOAD_INTERVAL_MS = 1000;

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

  const LAST_UPLOAD_TIME = null;

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
        const baseText = nameEl.cloneNode(true);
        baseText.querySelectorAll('svg, .Icon_icon__2LtL_').forEach(icon => icon.remove());
        name = baseText.textContent.trim();
      }

      const [, progress, total] = el.innerText.match(/Progress:\s*(\d+)\s*\/\s*(\d+)/) || [];

      let gold = null;
      let taskTokens = null;

      el.querySelectorAll('.Item_itemContainer__x7kH1').forEach(div => {
        const iconUse = div.querySelector('svg use')?.getAttribute('href') || '';
        const countText = div.querySelector('.Item_count__1HVvv')?.textContent.trim() || '';

        if (iconUse.includes('coin')) gold = countText;
        if (iconUse.includes('task_token')) taskTokens = countText;
      });

      return { 
        name, 
        progress: +progress, 
        total: +total, 
        gold, 
        taskTokens 
      };
    });
  }

  function areTasksSimilar(oldTasks, newTasks) {
    if (!oldTasks || oldTasks.length !== newTasks.length) return false;

    return !newTasks.some(task => {
      const match = oldTasks.find(t => t.name === task.name && t.total === task.total);
      if (!match) return true;

      const oldRemaining = match.total - match.progress;
      const newRemaining = task.total - task.progress;
      return Math.abs(oldRemaining - newRemaining) >= task.total * 0.4;
    });
  }

  function uploadToFirebase(username, tasks, slots, isManual = false) {
    const timestamp = new Date().toISOString();
    const countKey = `uploadCount_${username}_${timestamp.slice(0, 13)}`;
    const currentCount = GM_getValue(countKey, 0);
    const last = GM_getValue(`lastUpload_${username}`);

    if (currentCount >= 10) return console.warn(`[MWI Party Tasks] -- Hourly limit hit for ${username}`);
    if (areTasksSimilar(last?.tasks, tasks)) return console.log(`[MWI Party Tasks] -- No changes for ${username}`);

    fetch(`${DATABASE_URL}/party-tasks/${encodeURIComponent(username)}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp, slots, tasks })
    })
    .then(res => {
      if (res.ok) {
        GM_setValue(`lastUpload_${username}`, { tasks });
        GM_setValue(countKey, currentCount + 1);
        if (isManual) LAST_UPLOAD_TIME = Date.now();
        console.log('[MWI Party Tasks] -- Tasks uploaded!');
      } else {
        console.warn('[MWI Party Tasks] -- Upload error', res.statusText);
      }
    })
    .catch(e => console.error('[MWI Party Tasks] -- Upload error', e));
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

      const now = Date.now();

      if (now - LAST_UPLOAD_TIME < MANUAL_UPLOAD_INTERVAL_MS) {
        const secondsLeft = Math.ceil((MANUAL_UPLOAD_INTERVAL_MS - (now - LAST_UPLOAD_TIME)) / 1000);
        //alert(`⛔ Slow down! Try again in ${secondsLeft}s.`);
        return;
      }

      const tasks = extractTasksFromBoard();
      const slots = extractSlotInfo();
      uploadToFirebase(username, tasks, slots, true);
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

      if (tasksTabActive && slotRow && !document.querySelector(SELECTORS.taskButton)) {
        injectManualUploadButton();

        if (!username) return;

        const taskList = document.querySelector(SELECTORS.taskList);
        if (taskList) {
          const tasks = extractTasksFromBoard();
          const slots = extractSlotInfo();
          uploadToFirebase(username, tasks, slots);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('load', () => {
    setTimeout(injectGitHubNavLink, 1000);
  });

  setupTasksTabObserver();
})();
