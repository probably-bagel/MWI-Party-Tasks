// ==UserScript==
// @name         MWI Task Sync
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Sync Milky Way Idle task data to jsonbin.io
// @match        https://*.milkywayidle.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';
  
    const API_KEY = "$2a$10$BuzVhO.zxHogPcYrZbMjfu4Mj3hDMuBjKBaFQSt2lGj7zS0bDmXny";
    const BIN_IDS = {
      Medusaz: "680986898960c979a58bcc9e",
      Saquon: "680986b48561e97a5006383d",
      ZyzzBraah: "680986e38561e97a50063853"
    };
  
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
  
        const svgUse = taskEl.querySelector('.RandomTask_name__1hl1b svg use');
        const iconHref = svgUse?.getAttribute('href');
        const icon = iconHref ? `https://milkywayidle.com${iconHref}` : null;
  
        tasks.push({ name, progress, total, gold, tokens, icon });
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
  
    function uploadTasks(username, tasks, slots) {
      const binId = BIN_IDS[username];
      if (!binId) {
        console.warn(`[MWI] No bin assigned for user "${username}". Upload skipped.`);
        console.warn(`[MWI] Valid users: ${Object.keys(BIN_IDS).join(", ")}`);
        return;
      }
  
      const last = GM_getValue(`lastUpload_${username}`);
      const countKey = getUploadCountKey(username);
      const currentCount = GM_getValue(countKey, 0);
  
      if (currentCount >= 10) {
        console.warn(`[MWI] Skipped upload: hourly limit reached for ${username}`);
        return;
      }
  
      if (areTasksSimilar(last?.tasks, tasks)) {
        console.log(`[MWI] Skipped upload: no significant changes for ${username}`);
        return;
      }
  
      const payload = {
        user: username,
        tasks: tasks,
        slots: slots || null
      };
  
      GM_xmlhttpRequest({
            method: "PUT",
            url: `https://api.jsonbin.io/v3/b/${binId}`,
            headers: {
                "Content-Type": "application/json",
                "X-Master-Key": API_KEY,
                "X-Bin-Versioning": false
            },
            data: JSON.stringify({
                user: username,
                tasks,
                slots,
                timestamp: new Date().toISOString()
            }),
            onload: res => {
                if (res.status >= 200 && res.status < 300) {
                    console.log(`[MWI] Uploaded tasks for ${username}`, res.status);
                    GM_setValue(`lastUpload_${username}`, tasks);
                    GM_setValue(countKey, currentCount + 1);
                } else {
                    console.warn(`[MWI] Upload failed (${res.status}), not caching`, res.responseText);
                }
            },
            onerror: err => {
                console.error(`[MWI] Upload error for ${username}`, err);
            }
        });
    }
  
    function watchForTasksTab() {
      let lastActive = false;
  
      setInterval(() => {
        const active = Array.from(document.querySelectorAll('.NavigationBar_navigationLink__3eAHA'))
          .some(link => link.classList.contains('NavigationBar_active__3R-QS') &&
                        link.textContent.includes('Tasks'));
  
        if (active && !lastActive) {
          const username = getCurrentUsername();
          if (!username) return;
  
          console.log(`[MWI] Detected Tasks tab open for ${username}`);
  
          const tryExtract = () => {
            const taskList = document.querySelector('[class*="TasksPanel_taskList"]');
            if (taskList) {
              const tasks = extractTasksFromBoard();
              const slots = extractSlotInfo();
              uploadTasks(username, tasks, slots);
              return true;
            }
            return false;
          };
  
          if (!tryExtract()) {
            const observer = new MutationObserver(() => {
              if (tryExtract()) observer.disconnect();
            });
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }
  
        lastActive = active;
      }, 1000);
    }
  
    watchForTasksTab();
  })();
  