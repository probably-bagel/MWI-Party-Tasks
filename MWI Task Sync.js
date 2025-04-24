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
    const MANUAL_UPLOAD_INTERVAL_MS = 60 * 2 * 1000; // 2 mins
  
    function getCurrentUsername() {
      return document.querySelector('[data-name]')?.getAttribute('data-name') || null;
    }
  
    function extractSlotInfo() {
      const slotText = document.querySelector('.TasksPanel_taskSlotCount__nfhgS')?.textContent;
      const match = slotText?.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return {
          current: parseInt(match[1], 10),
          max: parseInt(match[2], 10)
        };
      }
      return null;
    }
  
    function extractTasksFromBoard() {
      const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
      if (!taskList) return [];
  
      const taskElements = taskList.querySelectorAll('[class*="RandomTask_randomTask"]');
      const tasks = [];
  
      taskElements.forEach(taskEl => {
        const name = taskEl.querySelector('[class*="RandomTask_name"]')?.textContent.trim();
        const progressText = taskEl.innerText.match(/Progress:\s*(\d+)\s*\/\s*(\d+)/);
        const progress = progressText ? Number(progressText[1]) : null;
        const total = progressText ? Number(progressText[2]) : null;
  
        let gold = null, tokens = null;
        const rewards = taskEl.querySelectorAll('.Item_itemContainer__x7kH1');
        rewards.forEach(div => {
          const icon = div.querySelector('svg use')?.getAttribute('href') || '';
          const count = Number(div.querySelector('.Item_count__1HVvv')?.textContent.replace(/,/g, ''));
          if (icon.includes('coin')) gold = count;
          if (icon.includes('task_token')) tokens = count;
        });
  
        tasks.push({ name, progress, total, gold, tokens });
      });
  
      return tasks;
    }
  
    function areTasksSimilar(oldTasks, newTasks) {
      if (!oldTasks || oldTasks.length !== newTasks.length) return false;
  
      for (let i = 0; i < newTasks.length; i++) {
        const newTask = newTasks[i];
        const oldTask = oldTasks.find(t => t.name === newTask.name && t.total === newTask.total);
        if (!oldTask) return false;
  
        const oldRemaining = oldTask.total - oldTask.progress;
        const newRemaining = newTask.total - newTask.progress;
        const delta = Math.abs(oldRemaining - newRemaining);
  
        if (delta >= newTask.total * 0.4) return false;
      }
  
      return true;
    }
  
    function getUploadCountKey(username) {
      const hourKey = new Date().toISOString().slice(0, 13);
      return `uploadCount_${username}_${hourKey}`;
    }
  
    function uploadToSharedBin(username, tasks, slots, isManual = false) {
      const countKey = getUploadCountKey(username);
      const currentCount = GM_getValue(countKey, 0);
      const last = GM_getValue(`lastUpload_${username}`);
  
      if (currentCount >= 10) {
        console.warn(`[MWI] Skipped upload: hourly limit reached for ${username}`);
        return;
      }
  
      if (areTasksSimilar(last?.tasks, tasks)) {
        console.log(`[MWI] Skipped upload: no significant changes for ${username}`);
        return;
      }
  
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,
        headers: { 'X-Master-Key': API_KEY },
        onload: res => {
          if (res.status !== 200) return console.error(`[MWI] Failed to fetch shared bin (${res.status})`);
  
          let existingData = {};
          try {
            existingData = JSON.parse(res.responseText).record || {};
          } catch (err) {
            console.error('[MWI] Failed to parse bin response:', err);
          }
  
          existingData[username] = {
            user: username,
            timestamp: new Date().toISOString(),
            slots,
            tasks
          };
  
          GM_xmlhttpRequest({
            method: "PUT",
            url: `https://api.jsonbin.io/v3/b/${BIN_ID}`,
            headers: {
              "Content-Type": "application/json",
              "X-Master-Key": API_KEY,
              "X-Bin-Versioning": false
            },
            data: JSON.stringify(existingData),
            onload: putRes => {
              if (putRes.status >= 200 && putRes.status < 300) {
                console.log(`[MWI] Synced ${username} data to shared bin`);
                GM_setValue(`lastUpload_${username}`, { tasks });
                GM_setValue(countKey, currentCount + 1);
                if (isManual) GM_setValue(`lastManualUpload_${username}`, Date.now());
              } else {
                console.warn(`[MWI] PUT failed (${putRes.status})`, putRes.responseText);
              }
            },
            onerror: err => console.error('[MWI] PUT error:', err)
          });
        },
        onerror: err => console.error('[MWI] GET error:', err)
      });
    }
  
    function injectManualUploadButton() {
      const slotRow = document.querySelector('.TasksPanel_taskSlotCount__nfhgS');
      if (!slotRow || document.querySelector('#mwi-manual-upload-btn')) return;
  
      const btn = document.createElement('button');
      btn.id = 'mwi-manual-upload-btn';
      btn.textContent = '⬆ Upload Tasks to Party ⬆';
      btn.className = 'Button_button__1Fe9z Button_small__3fqC7';
      btn.style.marginLeft = '6px';
  
      btn.addEventListener('click', () => {
        const username = getCurrentUsername();
        if (!username) return;
  
        const tasks = extractTasksFromBoard();
        const slots = extractSlotInfo();
        uploadToSharedBin(username, tasks, slots, true);
      });
  
      slotRow.appendChild(btn);
    }
  
    function setupTasksTabObserver() {
      const observer = new MutationObserver(() => {
          const tasksTabActive = Array.from(document.querySelectorAll('.NavigationBar_navigationLink__3eAHA'))
          .some(link => link.classList.contains('NavigationBar_active__3R-QS') &&
                link.textContent.includes('Tasks'));
  
          const slotRow = document.querySelector('.TasksPanel_taskSlotCount__nfhgS');
          if (tasksTabActive && slotRow && !document.querySelector('#mwi-manual-upload-btn')) {
              injectManualUploadButton();
  
              const username = getCurrentUsername();
              if (!username) return;
  
              const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
              if (taskList) {
                  const tasks = extractTasksFromBoard();
                  const slots = extractSlotInfo();
                  uploadToSharedBin(username, tasks, slots);
              }
          }
      });
  
      observer.observe(document.body, { childList: true, subtree: true });
    }
    setupTasksTabObserver();
  })();
  