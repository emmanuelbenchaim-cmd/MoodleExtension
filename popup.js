let allTasks = [];
let mySchedule = []; 
let recentUpdates = [];
let editingTaskId = null; 
let showCompleted = true; 
let showSchedule = true; 
let dragStartIndex = null; 
let activeCourseFilter = 'all'; 
let courseAliases = {};
let lastIcsUrl = ''; 
let scheduleInterval = null;

// הגדרות התראות חדשות
let notifSettings = { enabled: false, onNew: true, onUpdate: true, courses: {} };

const emptyStates = [
    { icon: '🏖️', text: 'הכל נקי! אפשר ללכת לים.' },
    { icon: '🎮', text: 'אין הגשות באופק. זמן לקונסולה!' },
    { icon: '☕', text: 'סיימת הכל. קח לעצמך קפה.' },
    { icon: '🏆', text: 'מערכת נקייה! אתה אלוף.' }
];

const dayNames = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function toggleSideMenu(forceClose = false) {
    const panel = document.getElementById('side-panel');
    const overlay = document.getElementById('side-panel-overlay');
    if (forceClose || panel.classList.contains('active')) {
        panel.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        panel.classList.add('active');
        overlay.classList.add('active');
    }
}

function updateSyncStatusUI(msg, statusClass = '') {
    const statusEl = document.getElementById('sync-status-text');
    if (statusEl) {
        statusEl.innerText = msg;
        statusEl.className = statusClass;
    }
}

function getDisplayCourse(originalCourse) {
    const safeCourse = String(originalCourse || 'ללא קורס');
    return courseAliases[safeCourse] || safeCourse;
}

function getCourseColor(str) {
    let hash = 0;
    const safeStr = String(str || '');
    for (let i = 0; i < safeStr.length; i++) hash = safeStr.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 65%, 88%)`;
}

function parseDateForSort(dateStr) {
    if (!dateStr || dateStr === 'ללא תאריך יעד' || dateStr.includes('פתוח')) return 9999999999999;
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/);
    if (!match) return 9999999999999;
    const [_, d, m, y, time] = match;
    return new Date(`${y}-${m}-${d}T${time}`).getTime();
}

function getUrgencyState(dateStr) {
    if (!dateStr || dateStr === 'ללא תאריך יעד' || dateStr.includes('פתוח')) return { class: '', label: 'ללא תאריך יעד' };
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/);
    if (!match) return { class: '', label: dateStr };
    const [_, d, m, y, time] = match;
    const dueDate = new Date(`${y}-${m}-${d}T${time}`);
    const diffHours = (dueDate - new Date()) / (1000 * 60 * 60);
    if (diffHours < 0) return { class: 'danger', label: 'באיחור / עבר זמנו' };
    if (diffHours < 24) return { class: 'danger', label: 'מחר! דחוף' };
    if (diffHours < 72) return { class: 'warning', label: 'קרוב' };
    return { class: '', label: 'בטוח' };
}

function fireConfetti(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    for (let i = 0; i < 20; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.left = rect.left + rect.width / 2 + 'px';
        confetti.style.top = rect.top + rect.height / 2 + 'px';
        const angle = Math.random() * Math.PI * 2;
        const velocity = 30 + Math.random() * 50;
        confetti.style.setProperty('--tx', Math.cos(angle) * velocity + 'px');
        confetti.style.setProperty('--ty', Math.sin(angle) * velocity + 'px');
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 800);
    }
}

function updateLiveSchedule() {
    const widget = document.getElementById('live-schedule-widget');
    if (!showSchedule || !mySchedule || mySchedule.length === 0) {
        widget.style.display = 'none';
        return;
    }
    widget.style.display = 'flex'; 
    const now = new Date();
    const currentDay = now.getDay(); 
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const todayClasses = mySchedule
        .filter(c => parseInt(c.day) === currentDay)
        .sort((a, b) => timeToMins(a.start) - timeToMins(b.start));

    let liveClass = null;
    let nextClass = null;

    for (let c of todayClasses) {
        const startMins = timeToMins(c.start);
        const endMins = timeToMins(c.end);
        
        if (currentMins >= startMins && currentMins <= endMins) {
            liveClass = c;
        } else if (currentMins < startMins && !nextClass) {
            nextClass = c;
        }
    }

    if (liveClass) {
        widget.classList.add('state-live');
        widget.classList.remove('state-idle');
        document.getElementById('live-class-title').innerText = `${liveClass.course} (${liveClass.type})`;
        document.getElementById('live-class-time').innerText = `${liveClass.start} - ${liveClass.end}`;
        document.getElementById('live-class-loc').innerText = `📍 ${liveClass.loc || 'ללא חדר'}`;
        
        const startMins = timeToMins(liveClass.start);
        const endMins = timeToMins(liveClass.end);
        const totalDuration = endMins - startMins;
        const elapsed = currentMins - startMins;
        let percent = Math.floor(Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)));
        
        document.getElementById('live-class-progress').style.width = `${percent}%`;
        document.getElementById('live-class-percent').innerText = `${percent}%`;
        document.getElementById('live-class-meta').style.display = 'flex';
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('live-class-percent').style.display = 'block';
    } else {
        widget.classList.add('state-idle');
        widget.classList.remove('state-live');
        document.getElementById('live-class-title').innerText = "אין שיעור כרגע";
        document.getElementById('live-class-meta').style.display = 'none';
        document.getElementById('progress-container').style.display = 'none';
        document.getElementById('live-class-percent').style.display = 'none';
    }

    const nextInfoEl = document.getElementById('next-class-info');
    if (nextClass) {
        nextInfoEl.style.display = 'flex';
        nextInfoEl.innerHTML = `<span>הבא: ${nextClass.course}</span><span>${nextClass.start}</span>`;
    } else {
        nextInfoEl.style.display = 'none';
    }
}

function timeToMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':');
    return parseInt(h) * 60 + parseInt(m);
}

function parseExcelSchedule(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let newClasses = [];
    for (let line of lines) {
        if (line.includes('שם קורס') && line.includes('מפגשים')) continue;
        const cols = line.split('\t');
        if (cols.length < 3) continue;
        let meetColIdx = cols.findIndex(c => c.includes('יום'));
        if (meetColIdx === -1) continue;

        let meetStr = cols[meetColIdx];
        let courseName = "";
        let type = "";

        if (meetColIdx === 0) {
            courseName = cols[4] || cols[cols.length-2] || 'קורס לא ידוע';
            type = cols[3] || cols[cols.length-3] || '';
        } else {
            courseName = cols[1] || cols[cols.length-2] || 'קורס לא ידוע';
            type = cols[2] || cols[cols.length-3] || '';
        }

        let m = meetStr.match(/יום\s*([א-ו])'*:\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*,\s*(.+)/);
        if (m) {
            const dayMap = {'א':0, 'ב':1, 'ג':2, 'ד':3, 'ה':4, 'ו':5};
            newClasses.push({
                id: 'cls_' + Date.now() + Math.random().toString(36).substr(2,5),
                course: courseName.trim(),
                type: type.trim(),
                day: dayMap[m[1]],
                start: m[2],
                end: m[3],
                loc: m[4].trim()
            });
        }
    }
    return newClasses;
}

function renderScheduleEditList() {
    const list = document.getElementById('schedule-edit-list');
    list.innerHTML = '';
    const sorted = [...mySchedule].sort((a,b) => {
        if(a.day !== b.day) return a.day - b.day;
        return timeToMins(a.start) - timeToMins(b.start);
    });

    sorted.forEach((cls) => {
        const row = document.createElement('div');
        row.className = 'schedule-edit-row';
        row.dataset.id = cls.id;
        row.innerHTML = `
            <div class="schedule-edit-row-top">
                <input type="text" class="edit-cls-name" value="${cls.course.replace(/"/g, '&quot;')}" style="flex:1;" placeholder="שם הקורס">
                <input type="text" class="edit-cls-type" value="${cls.type}" style="width:80px;" placeholder="סוג">
                <select class="edit-cls-day" style="width:90px;">
                    ${dayNames.map((d, i) => `<option value="${i}" ${parseInt(cls.day)===i ? 'selected':''}>יום ${d}'</option>`).join('')}
                </select>
            </div>
            <div class="schedule-edit-row-bottom">
                <span style="font-size: 13px; color: var(--text-muted); white-space:nowrap;">שעות:</span>
                <input type="time" class="edit-cls-start" value="${cls.start}" style="width:90px;">
                <span style="color:var(--text-muted);">-</span>
                <input type="time" class="edit-cls-end" value="${cls.end}" style="width:90px;">
                <input type="text" class="edit-cls-loc" value="${cls.loc}" style="flex:1;" placeholder="חדר/בניין">
                <button class="danger-btn delete-cls-btn" data-id="${cls.id}" title="מחק שיעור" style="padding: 6px 12px;">🗑️</button>
            </div>
        `;
        list.appendChild(row);
    });

    document.querySelectorAll('.delete-cls-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            mySchedule = mySchedule.filter(c => c.id !== id);
            renderScheduleEditList();
        });
    });
}

function saveScheduleFromEditor() {
    const rows = document.querySelectorAll('.schedule-edit-row');
    let updatedSchedule = [];
    rows.forEach(row => {
        updatedSchedule.push({
            id: row.dataset.id,
            course: row.querySelector('.edit-cls-name').value.trim(),
            type: row.querySelector('.edit-cls-type').value.trim(),
            day: parseInt(row.querySelector('.edit-cls-day').value),
            start: row.querySelector('.edit-cls-start').value,
            end: row.querySelector('.edit-cls-end').value,
            loc: row.querySelector('.edit-cls-loc').value.trim()
        });
    });
    mySchedule = updatedSchedule;
    chrome.storage.local.set({ mySchedulePref: mySchedule }, () => {
        updateLiveSchedule();
        document.getElementById('schedule-modal').classList.remove('active');
    });
}

function renderVisualSchedule() {
    const container = document.getElementById('weekly-timetable-container');
    container.innerHTML = '';
    const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
    let minMin = 8 * 60; 
    let maxMin = 21 * 60; 
    
    if (mySchedule && mySchedule.length > 0) {
        const allStarts = mySchedule.map(c => timeToMins(c.start));
        const allEnds = mySchedule.map(c => timeToMins(c.end));
        minMin = Math.floor(Math.min(...allStarts) / 60) * 60; 
        maxMin = Math.ceil(Math.max(...allEnds) / 60) * 60; 
    }
    
    maxMin += 60; 
    const totalMins = maxMin - minMin;

    days.forEach((dayName, dayIndex) => {
        const dayCol = document.createElement('div');
        dayCol.className = 'timetable-day';
        const header = document.createElement('div');
        header.className = 'timetable-day-header';
        header.innerText = `יום ${dayName}'`;
        const body = document.createElement('div');
        body.className = 'timetable-day-body';
        
        const dayClasses = mySchedule.filter(c => parseInt(c.day) === dayIndex);
        dayClasses.forEach(cls => {
            const startM = timeToMins(cls.start);
            const endM = timeToMins(cls.end);
            const topPercent = ((startM - minMin) / totalMins) * 100;
            const heightPercent = ((endM - startM) / totalMins) * 100;

            const block = document.createElement('div');
            block.className = 'timetable-class-block';
            block.style.top = `${topPercent}%`;
            block.style.height = `calc(${heightPercent}% - 2px)`; 
            
            const displayCourse = courseAliases[cls.course] || cls.course;
            block.innerHTML = `
                <span class="timetable-class-title" title="${cls.course}">${displayCourse}</span>
                <span class="timetable-class-time">${cls.start} - ${cls.end}</span>
                <span class="timetable-class-time" style="margin-top:auto;">📍 ${cls.loc || 'ללא כיתה'}</span>
            `;
            body.appendChild(block);
        });
        
        dayCol.appendChild(header);
        dayCol.appendChild(body);
        container.appendChild(dayCol);
    });
}

function renderSidebar() {
    const courseList = document.getElementById('course-list');
    if (!courseList) return;
    
    const displayCourses = [...new Set(allTasks.map(t => getDisplayCourse(t.course)))].sort();
    if (activeCourseFilter !== 'all' && !displayCourses.includes(activeCourseFilter)) activeCourseFilter = 'all';

    const totalTasksVisible = showCompleted ? allTasks.length : allTasks.filter(t => !t.isDone).length;
    let html = `
        <li class="course-item ${activeCourseFilter === 'all' ? 'active' : ''}" data-course="all">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                <span style="font-size: 16px;">📚</span>
                <span class="course-name-text" style="padding-left: 0; font-weight: 700;">כל המטלות</span>
            </div>
            <span class="course-count">${totalTasksVisible}</span>
        </li>
    `;
    
    displayCourses.forEach(dCourse => {
        const tasksInCourse = allTasks.filter(t => getDisplayCourse(t.course) === dCourse && (showCompleted ? true : !t.isDone)).length;
        if (tasksInCourse > 0 || showCompleted) {
            const safeCourse = dCourse.replace(/"/g, '&quot;');
            const courseColor = getCourseColor(dCourse); 
            const isActive = activeCourseFilter === dCourse;
            html += `
                <li class="course-item ${isActive ? 'active' : ''}" data-course="${safeCourse}" title="${safeCourse}">
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                        <span style="width: 12px; height: 12px; border-radius: 50%; background: ${courseColor}; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); flex-shrink: 0;"></span>
                        <span class="course-name-text" style="padding-left: 0;">${dCourse}</span>
                    </div>
                    <span class="course-count" style="background: ${courseColor};">${tasksInCourse}</span>
                </li>
            `;
        }
    });
    courseList.innerHTML = html;
    
    document.querySelectorAll('.course-item').forEach(item => {
        item.addEventListener('click', function() {
            activeCourseFilter = this.dataset.course;
            renderTasks();
        });
    });
}

function saveDataAndRender() { chrome.storage.local.set({ savedMoodleTasks: allTasks }, renderTasks); }

function checkParentCompletion(task) {
    if (task.subTasks && task.subTasks.length > 0) {
        const allDone = task.subTasks.every(st => st.isDone);
        task.isDone = allDone;
        if (allDone) setTimeout(() => fireConfetti(document.querySelector(`[data-id="${task.id}"]`)), 100);
    }
}

function renderTasks() {
    renderSidebar(); 
    const container = document.getElementById('tasks-container');
    if (!container) return;
    container.innerHTML = '';

    let filteredTasks = showCompleted ? [...allTasks] : allTasks.filter(t => !t.isDone);
    if (activeCourseFilter !== 'all') filteredTasks = filteredTasks.filter(t => getDisplayCourse(t.course) === activeCourseFilter);

    if (filteredTasks.length === 0) {
        const randomState = emptyStates[Math.floor(Math.random() * emptyStates.length)];
        container.innerHTML = `<div class="empty-state"><span>${randomState.icon}</span><div>${randomState.text}</div></div>`;
        return;
    }

    const sortBy = document.getElementById('sort-select').value;
    if (sortBy === 'course') {
        filteredTasks.sort((a, b) => {
            const courseCompare = getDisplayCourse(a.course).localeCompare(getDisplayCourse(b.course));
            if (courseCompare !== 0) return courseCompare;
            return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true });
        });
    } else if (sortBy === 'date') {
        filteredTasks.sort((a, b) => parseDateForSort(a.dateStr) - parseDateForSort(b.dateStr));
    }

    if (showCompleted) {
        const pendingTasks = filteredTasks.filter(t => !t.isDone);
        const completedTasks = filteredTasks.filter(t => t.isDone);
        filteredTasks = [...pendingTasks, ...completedTasks];
    }

    filteredTasks.forEach((task) => {
        const taskDiv = document.createElement('div');
        taskDiv.className = `task ${task.isDone ? 'done' : ''}`;
        taskDiv.setAttribute('draggable', true);
        taskDiv.dataset.id = task.id;

        const safeTitle = String(task.title || '');
        const safeUrl = task.url ? String(task.url).replace(/"/g, '&quot;') : '';
        const titleHtml = task.url ? `<a href="${safeUrl}" target="_blank" class="task-title" title="פתח במודל">${safeTitle}</a>` : `<span class="task-title">${safeTitle}</span>`;
        
        const dCourse = getDisplayCourse(task.course);
        const courseBg = getCourseColor(dCourse);
        const urgency = getUrgencyState(task.dateStr);

        let subTasksHtml = '';
        if (task.subTasks) {
            task.subTasks.forEach(st => {
                const safeStTitle = st.title ? String(st.title).replace(/"/g, '&quot;') : '';
                subTasksHtml += `
                    <div class="subtask-item ${st.isDone ? 'done' : ''}" data-subid="${st.id}">
                        <input type="checkbox" class="subtask-check" ${st.isDone ? 'checked' : ''}>
                        <input type="text" class="subtask-input" value="${safeStTitle}" placeholder="שם המשימה...">
                        <button class="btn-delete-subtask" title="מחק תת-משימה">✕</button>
                    </div>
                `;
            });
        }

        taskDiv.innerHTML = `
            <div class="task-header">
                <div class="task-left-section">
                    <div class="drag-handle" title="גרור כדי לסדר">⋮⋮</div>
                    <div class="task-info">
                        ${titleHtml}
                        <div class="meta-row">
                            <span class="course-tag" style="background: ${courseBg}" title="${task.course !== dCourse ? `מקור: ${task.course}` : ''}">${dCourse}</span>
                            <span class="due-date"><div class="urgency-dot ${urgency.class}" title="${urgency.label}"></div> ${task.dateStr || 'ללא תאריך'}</span>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button class="icon-btn edit" title="ערוך הגשה">✏️</button>
                    <button class="icon-btn delete" title="מחק">🗑️</button>
                    <input type="checkbox" class="task-done-check" title="סמן כבוצע" ${task.isDone ? 'checked' : ''}>
                </div>
            </div>
            <div class="subtasks-container">
                ${subTasksHtml}
                <button class="btn-add-subtask">+ תת משימה</button>
            </div>
        `;
        container.appendChild(taskDiv);

        const linkEl = taskDiv.querySelector('.task-title');
        if (linkEl && linkEl.tagName === 'A') {
            linkEl.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ url: task.url });
            });
        }

        taskDiv.querySelector('.task-done-check').addEventListener('change', function() {
            task.isDone = this.checked;
            if (task.subTasks) task.subTasks.forEach(st => st.isDone = this.checked);
            if (this.checked) fireConfetti(this);
            saveDataAndRender();
        });

        taskDiv.querySelector('.delete').addEventListener('click', function() {
            taskDiv.classList.add('deleting');
            setTimeout(() => {
                allTasks = allTasks.filter(t => t.id !== task.id);
                saveDataAndRender();
            }, 300);
        });

        taskDiv.querySelector('.btn-add-subtask').addEventListener('click', () => {
            if (!task.subTasks) task.subTasks = [];
            task.subTasks.push({ id: 'st_' + Date.now(), title: '', isDone: false });
            task.isDone = false; 
            saveDataAndRender();
        });

        taskDiv.querySelectorAll('.subtask-item').forEach(stItem => {
            const stId = stItem.dataset.subid;
            const subTask = task.subTasks.find(s => s.id === stId);
            stItem.querySelector('.subtask-input').addEventListener('change', (e) => { subTask.title = e.target.value; saveDataAndRender(); });
            stItem.querySelector('.btn-delete-subtask').addEventListener('click', () => {
                task.subTasks = task.subTasks.filter(s => s.id !== stId);
                if (task.subTasks.length > 0 && task.subTasks.every(st => st.isDone)) { task.isDone = true; fireConfetti(taskDiv); }
                saveDataAndRender();
            });
            stItem.querySelector('.subtask-check').addEventListener('change', function() {
                subTask.isDone = this.checked;
                if (this.checked) fireConfetti(this);
                if (task.subTasks.length > 0 && task.subTasks.every(st => st.isDone)) { task.isDone = true; fireConfetti(taskDiv); }
                saveDataAndRender();
            });
        });

        taskDiv.querySelector('.edit').addEventListener('click', () => {
            editingTaskId = task.id;
            document.getElementById('form-title').innerText = 'עריכת מטלה';
            document.getElementById('task-title-input').value = task.title || '';
            document.getElementById('task-course-input').value = task.course || '';
            if (task.dateStr) {
                const match = task.dateStr.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/);
                if (match) document.getElementById('task-date-input').value = `${match[3]}-${match[2]}-${match[1]}T${match[4]}`;
            }
            document.getElementById('task-form-modal').classList.add('active');
        });

        taskDiv.addEventListener('dragstart', (e) => { dragStartIndex = allTasks.indexOf(task); e.dataTransfer.effectAllowed = 'move'; taskDiv.style.opacity = '0.5'; });
        taskDiv.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        taskDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropTargetDiv = e.target.closest('.task');
            if (!dropTargetDiv) return;
            const taskAtDropTarget = allTasks.find(t => t.id === dropTargetDiv.dataset.id);
            const dragEndIndex = allTasks.indexOf(taskAtDropTarget);
            if (dragStartIndex !== dragEndIndex && dragStartIndex !== null && dragEndIndex !== -1) {
                document.getElementById('sort-select').value = 'custom';
                chrome.storage.local.set({ sortPref: 'custom' });
                const itemToMove = allTasks[dragStartIndex];
                allTasks.splice(dragStartIndex, 1);
                allTasks.splice(dragEndIndex, 0, itemToMove);
                saveDataAndRender();
            }
        });
        taskDiv.addEventListener('dragend', () => { taskDiv.style.opacity = '1'; dragStartIndex = null; });
    });
}

function parseICSData(data) {
    const lines = data.split(/\r?\n/);
    const events = [];
    let isEvent = false;
    let event = {};
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        while (i + 1 < lines.length && (lines[i+1].startsWith(' ') || lines[i+1].startsWith('\t'))) {
            i++;
            line += lines[i].substring(1);
        }
        if (line.trim() === 'BEGIN:VEVENT' || line.trim() === 'BEGIN:VTODO') { isEvent = true; event = {}; } 
        else if (line.trim() === 'END:VEVENT' || line.trim() === 'END:VTODO') { isEvent = false; events.push(event); } 
        else if (isEvent) {
            const sep = line.indexOf(':');
            if (sep !== -1) {
                const key = line.substring(0, sep).split(';')[0].trim();
                let val = line.substring(sep + 1).trim();
                val = val.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
                event[key] = val;
            }
        }
    }
    return events;
}

function renderUpdatesList() {
    const container = document.getElementById('updates-list-container');
    if (!recentUpdates || recentUpdates.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 20px;">אין עדכונים כרגע. ברגע שיעודכנו מטלות ממודל, הם יופיעו כאן.</div>';
        return;
    }
    container.innerHTML = recentUpdates.map(u => `
        <div class="update-item">
            <span class="update-time">${u.dateStr}</span>
            <span class="update-text">${u.type === 'new' ? '✨' : '🔄'} ${u.text}</span>
        </div>
    `).join('');
}

// שליחת התראות (למקרים שהחלון פתוח ויש שינוי)
function fireNotification(title, message, isNew, course) {
    if (!notifSettings.enabled) return;
    if (isNew && !notifSettings.onNew) return;
    if (!isNew && !notifSettings.onUpdate) return;
    if (notifSettings.courses[course] === false) return;

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        title: title,
        message: message
    });
}

async function runIcsSync(url, isSilent = false) {
    updateSyncStatusUI('בודק עדכונים במודל... ⏳', 'syncing');
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error');
        const icsData = await response.text();
        const events = parseICSData(icsData);
        
        let addedCount = 0; 
        let updatedCount = 0;
        let newLogs = []; 

        events.forEach(ev => {
            const rawContent = ((ev.URL || '') + ' ' + (ev.DESCRIPTION || '') + ' ' + (ev.SUMMARY || '')).toLowerCase();
            if (rawContent.includes('נוכחות') || rawContent.includes('attendance')) return; 

            let taskUrl = ev.URL || '';
            if (!taskUrl && ev.DESCRIPTION) {
                let match = ev.DESCRIPTION.match(/href=\\?["']?(https?:\/\/[^"'\s>]+)/i);
                if (match) taskUrl = match[1];
                else { let match2 = ev.DESCRIPTION.match(/(https?:\/\/[^\s"'><\\]+)/i); if (match2) taskUrl = match2[1]; }
            }

            let title = ev.SUMMARY || 'מטלה ללא שם';
            let course = ev.CATEGORIES || '';
            if (title.includes(':')) {
                const parts = title.split(':');
                if (!course) course = parts[0].trim(); 
                title = parts.slice(1).join(':').trim(); 
            }
            if (!course) course = 'ללא קורס';

            let dateStr = 'ללא תאריך יעד';
            if (ev.DTEND || ev.DTSTART) {
                const match = (ev.DTEND || ev.DTSTART).match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
                if (match) {
                    const [_, y, m, d, H, M, S] = match;
                    if ((ev.DTEND || ev.DTSTART).endsWith('Z')) {
                        let dt = new Date(`${y}-${m}-${d}T${H}:${M}:${S}Z`);
                        dateStr = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
                    } else {
                        dateStr = `${d}/${m}/${y} ${H}:${M}`;
                    }
                }
            }

            const cleanTitle = title.replace(/is due/gi, '').trim();
            const safeId = "ics_" + (ev.UID || btoa(unescape(encodeURIComponent(title + dateStr))).substring(0, 15)).replace(/[^a-zA-Z0-9_]/g, '');
            const existingTaskIndex = allTasks.findIndex(t => t.id === safeId);
            const displayCourseName = courseAliases[course] || course;
            
            if (existingTaskIndex !== -1) {
                const existingTask = allTasks[existingTaskIndex];
                let changed = false;
                const doneNotice = existingTask.isDone ? " (✅ כבר סומנה כבוצעה)" : "";

                if (existingTask.dateStr !== dateStr) {
                    newLogs.push({ type: 'update', text: `[${displayCourseName}] המטלה "${cleanTitle}" נדחתה/השתנתה ל-${dateStr}${doneNotice}` });
                    changed = true;
                } else if (existingTask.title !== cleanTitle || existingTask.course !== course || existingTask.url !== taskUrl) {
                    newLogs.push({ type: 'update', text: `[${displayCourseName}] פרטי המטלה "${cleanTitle}" עודכנו${doneNotice}` });
                    changed = true;
                }

                if (changed) {
                    existingTask.dateStr = dateStr; 
                    existingTask.title = cleanTitle; 
                    existingTask.course = course; 
                    existingTask.url = taskUrl || existingTask.url;
                    updatedCount++;
                    fireNotification('Moodle Organizer - עדכון מטלה 🔄', `[${displayCourseName}] ${cleanTitle}\nעודכן ל-${dateStr}`, false, course);
                }
            } else {
                allTasks.push({ id: safeId, title: cleanTitle, course: course, dateStr: dateStr, url: taskUrl, isDone: false, subTasks: [] });
                newLogs.push({ type: 'new', text: `[${displayCourseName}] התווספה הגשה חדשה: ${cleanTitle}` });
                addedCount++;
                fireNotification('Moodle Organizer - מטלה חדשה! ✨', `[${displayCourseName}] ${cleanTitle}\nלמתי? ${dateStr}`, true, course);
            }
        });

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        if (addedCount > 0 || updatedCount > 0) {
            saveDataAndRender();
            let statusText = `עודכן כעת! (נוספו: ${addedCount}, השתנו: ${updatedCount})`;
            updateSyncStatusUI(statusText, 'success');
            chrome.storage.local.set({ lastSyncMsgPref: `עדכון אחרון: ${timeStr} (היו שינויים)` });
            
            if (newLogs.length > 0) {
                const logTimeStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth()+1).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                newLogs.forEach(log => {
                    recentUpdates.unshift({ id: Date.now() + Math.random(), text: log.text, dateStr: logTimeStr, type: log.type });
                });
                recentUpdates = recentUpdates.slice(0, 50); 
                chrome.storage.local.set({ recentUpdatesPref: recentUpdates });
            }

            if (!isSilent) {
                alert(`סנכרון עבר בהצלחה! 🎉\nנוספו: ${addedCount}\nעודכנו: ${updatedCount}`);
                document.getElementById('ics-modal').classList.remove('active');
            }
        } else {
            let statusText = `עדכון אחרון: היום ב-${timeStr}`;
            updateSyncStatusUI(statusText, '');
            chrome.storage.local.set({ lastSyncMsgPref: statusText });
            if (!isSilent) {
                document.getElementById('ics-status').innerText = 'הכל כבר מעודכן! לא היו שינויים.';
                document.getElementById('ics-status').style.color = 'var(--success)';
            }
        }
        lastIcsUrl = url;
        chrome.storage.local.set({ lastIcsUrlPref: url });

    } catch (error) {
        updateSyncStatusUI('שגיאת חיבור למודל', 'danger');
        if (!isSilent) {
            document.getElementById('ics-status').innerText = 'שגיאה. ודא שהקישור חוקי והרשת מחוברת.';
            document.getElementById('ics-status').style.color = 'var(--danger)';
        }
    }
}

// פונקציה לרינדור רשימת הקורסים בחלון התראות
function renderNotifCourses() {
    const list = document.getElementById('notif-courses-list');
    const uniqueCourses = [...new Set(allTasks.map(t => String(t.course || 'ללא קורס')))].sort();

    if (uniqueCourses.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">אין קורסים במערכת עדיין. סנכרן קודם.</div>';
        return;
    }

    list.innerHTML = uniqueCourses.map(course => {
        const displayCourse = courseAliases[course] || course;
        const safeCourse = course.replace(/"/g, '&quot;');
        const isChecked = notifSettings.courses[course] !== false; // ברירת מחדל true
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:14px; font-weight:500;">${displayCourse}</span>
                <input type="checkbox" class="notif-course-check" data-course="${safeCourse}" ${isChecked ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--blue);">
            </div>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    
    chrome.storage.local.get(['savedMoodleTasks', 'showCompletedPref', 'sortPref', 'courseAliasesPref', 'lastIcsUrlPref', 'lastSyncMsgPref', 'darkModePref', 'mySchedulePref', 'showSchedulePref', 'recentUpdatesPref', 'notifSettingsPref'], (result) => {
        if (result.darkModePref) { document.body.classList.add('dark-mode'); document.getElementById('dark-mode-toggle').checked = true; }
        if (result.savedMoodleTasks) allTasks = result.savedMoodleTasks.map(t => ({ ...t, subTasks: t.subTasks || [] }));
        if (result.mySchedulePref) mySchedule = result.mySchedulePref;
        if (result.recentUpdatesPref) recentUpdates = result.recentUpdatesPref;
        if (result.notifSettingsPref) notifSettings = result.notifSettingsPref;
        if (result.showCompletedPref !== undefined) showCompleted = result.showCompletedPref;
        if (result.sortPref !== undefined) document.getElementById('sort-select').value = result.sortPref;
        if (result.courseAliasesPref !== undefined) courseAliases = result.courseAliasesPref;
        if (result.lastIcsUrlPref) lastIcsUrl = result.lastIcsUrlPref;
        
        if (result.showSchedulePref !== undefined) showSchedule = result.showSchedulePref;
        document.getElementById('show-schedule-toggle').checked = showSchedule;
        
        if (result.lastSyncMsgPref) updateSyncStatusUI(result.lastSyncMsgPref);
        else updateSyncStatusUI('טרם סונכרן (הגדר יומן)');

        document.getElementById('show-completed-check').checked = showCompleted;
        renderTasks();
        
        updateLiveSchedule();
        scheduleInterval = setInterval(updateLiveSchedule, 60000); 

        if (lastIcsUrl) runIcsSync(lastIcsUrl, true);
    });

    document.getElementById('settings-trigger-btn').addEventListener('click', () => toggleSideMenu(false));
    document.getElementById('close-panel-btn').addEventListener('click', () => toggleSideMenu(true));
    document.getElementById('side-panel-overlay').addEventListener('click', () => toggleSideMenu(true));

    document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
        if (e.target.checked) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
        chrome.storage.local.set({ darkModePref: e.target.checked });
    });

    document.getElementById('show-schedule-toggle').addEventListener('change', (e) => {
        showSchedule = e.target.checked;
        chrome.storage.local.set({ showSchedulePref: showSchedule });
        updateLiveSchedule();
    });

    document.getElementById('menu-refresh-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        if (lastIcsUrl) runIcsSync(lastIcsUrl, false);
        else alert('קודם פתח את התפריט ☰, לחץ על "סנכרון יומן מודל" והכנס את קישור היומן שלך.');
    });

    // כפתור הגדרות התראות
    document.getElementById('notifications-settings-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        document.getElementById('notif-global-toggle').checked = notifSettings.enabled;
        document.getElementById('notif-new-toggle').checked = notifSettings.onNew;
        document.getElementById('notif-update-toggle').checked = notifSettings.onUpdate;
        renderNotifCourses();
        document.getElementById('notifications-modal').classList.add('active');
    });

    document.getElementById('close-notif-modal').addEventListener('click', () => document.getElementById('notifications-modal').classList.remove('active'));

    document.getElementById('notif-select-all').addEventListener('click', () => document.querySelectorAll('.notif-course-check').forEach(cb => cb.checked = true));
    document.getElementById('notif-deselect-all').addEventListener('click', () => document.querySelectorAll('.notif-course-check').forEach(cb => cb.checked = false));

    document.getElementById('save-notif-btn').addEventListener('click', () => {
        notifSettings.enabled = document.getElementById('notif-global-toggle').checked;
        notifSettings.onNew = document.getElementById('notif-new-toggle').checked;
        notifSettings.onUpdate = document.getElementById('notif-update-toggle').checked;
        document.querySelectorAll('.notif-course-check').forEach(cb => {
            notifSettings.courses[cb.dataset.course] = cb.checked;
        });
        chrome.storage.local.set({ notifSettingsPref: notifSettings });
        document.getElementById('notifications-modal').classList.remove('active');
        
        // נבקש אישור מערכת למקרה שההתראות מופעלות פעם ראשונה
        if (notifSettings.enabled) chrome.permissions.request({ permissions: ['notifications'] });
    });

    document.getElementById('updates-history-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        renderUpdatesList();
        document.getElementById('updates-modal').classList.add('active');
    });
    
    document.getElementById('close-updates-modal').addEventListener('click', () => document.getElementById('updates-modal').classList.remove('active'));

    document.getElementById('view-weekly-btn').addEventListener('click', () => {
        renderVisualSchedule();
        document.getElementById('weekly-schedule-modal').classList.add('active');
    });
    
    document.getElementById('close-weekly-schedule-modal').addEventListener('click', () => document.getElementById('weekly-schedule-modal').classList.remove('active'));

    document.getElementById('show-completed-check').addEventListener('change', (e) => { showCompleted = e.target.checked; chrome.storage.local.set({ showCompletedPref: showCompleted }); renderTasks(); });
    document.getElementById('sort-select').addEventListener('change', (e) => { chrome.storage.local.set({ sortPref: e.target.value }); renderTasks(); });

    document.getElementById('schedule-mgmt-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        document.getElementById('schedule-modal').classList.add('active');
        renderScheduleEditList();
    });

    document.getElementById('close-schedule-modal').addEventListener('click', () => document.getElementById('schedule-modal').classList.remove('active'));

    document.getElementById('parse-excel-btn').addEventListener('click', () => {
        const text = document.getElementById('excel-paste-area').value;
        if (!text.trim()) return alert("הדבק קודם את הטבלה מהאקסל");
        const newClasses = parseExcelSchedule(text);
        if (newClasses.length > 0) {
            mySchedule = [...mySchedule, ...newClasses];
            renderScheduleEditList();
            document.getElementById('excel-paste-area').value = '';
            alert(`מעולה! נוספו ${newClasses.length} שיעורים חדשים. זכור ללחוץ על "שמור מערכת שעות" למטה.`);
        } else {
            alert("לא נמצאו שיעורים. ודא שהעתקת את עמודת ה'מפגשים' מהאקסל בדיוק כמו שהיא.");
        }
    });

    document.getElementById('add-manual-class-btn').addEventListener('click', () => {
        mySchedule.push({ id: 'cls_' + Date.now(), course: '', type: 'שעור', day: 0, start: '08:00', end: '10:00', loc: '' });
        renderScheduleEditList();
    });

    document.getElementById('save-schedule-btn').addEventListener('click', saveScheduleFromEditor);

    document.getElementById('settings-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        const modal = document.getElementById('settings-modal');
        const listContainer = document.getElementById('settings-aliases-list');
        const originalCourses = [...new Set(allTasks.map(t => String(t.course || 'ללא קורס')))].sort();
        
        if (originalCourses.length === 0) listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">אין עדיין קורסים במערכת.</div>';
        else {
            let html = '';
            originalCourses.forEach(orig => {
                const currentAlias = courseAliases[orig] || '';
                const safeDisplayOrig = orig.replace(/"/g, '&quot;');
                html += `
                    <div class="alias-row" style="display: flex; flex-direction: column; gap: 8px; background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 10px;">
                        <div style="font-size:14px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeDisplayOrig}">${orig}</div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color:var(--text-muted); font-size:18px;">↳</span>
                            <input type="text" class="alias-input" data-original="${safeDisplayOrig}" value="${currentAlias}" placeholder="הזן כינוי חדש להצגה..." style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid var(--border); background:var(--card-bg); outline:none;">
                        </div>
                    </div>
                `;
            });
            listContainer.innerHTML = html;
        }
        modal.classList.add('active');
    });

    document.getElementById('cancel-settings-btn').addEventListener('click', () => document.getElementById('settings-modal').classList.remove('active'));
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        const inputs = document.querySelectorAll('.alias-input');
        inputs.forEach(input => {
            const originalName = input.dataset.original;
            const newAlias = input.value.trim();
            if (newAlias && newAlias !== originalName) courseAliases[originalName] = newAlias;
            else delete courseAliases[originalName]; 
        });
        chrome.storage.local.set({ courseAliasesPref: courseAliases }, () => {
            activeCourseFilter = 'all'; 
            renderTasks();
            document.getElementById('settings-modal').classList.remove('active');
        });
    });

    document.getElementById('add-new-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        editingTaskId = null;
        document.getElementById('form-title').innerText = 'מטלה חדשה';
        document.getElementById('task-title-input').value = '';
        document.getElementById('task-course-input').value = '';
        document.getElementById('task-date-input').value = '';
        document.getElementById('task-form-modal').classList.add('active');
    });

    document.getElementById('cancel-form-btn').addEventListener('click', () => document.getElementById('task-form-modal').classList.remove('active'));
    document.getElementById('save-form-btn').addEventListener('click', () => {
        const title = document.getElementById('task-title-input').value.trim();
        const course = document.getElementById('task-course-input').value.trim() || 'כללי';
        const rawDate = document.getElementById('task-date-input').value; 
        if (!title) return alert("חובה להזין את שם המטלה");

        let finalDateStr = 'ללא תאריך יעד';
        if (rawDate) {
            const [dPart, tPart] = rawDate.split('T');
            const [y, m, d] = dPart.split('-');
            finalDateStr = `${d}/${m}/${y} ${tPart}`;
        } else if (editingTaskId) {
            const old = allTasks.find(t => t.id === editingTaskId);
            if (old) finalDateStr = old.dateStr;
        }

        if (editingTaskId) {
            const idx = allTasks.findIndex(t => t.id === editingTaskId);
            if (idx !== -1) { allTasks[idx].title = title; allTasks[idx].course = course; allTasks[idx].dateStr = finalDateStr; }
        } else {
            allTasks.push({ id: "manual_" + Date.now(), title, course, dateStr: finalDateStr, isDone: false, subTasks: [] });
        }
        saveDataAndRender();
        document.getElementById('task-form-modal').classList.remove('active');
    });

    document.getElementById('import-ics-btn').addEventListener('click', () => {
        toggleSideMenu(true);
        document.getElementById('ics-modal').classList.add('active');
        document.getElementById('ics-status').innerText = '';
        if (lastIcsUrl) document.getElementById('ics-url-input').value = lastIcsUrl;
    });

    document.getElementById('cancel-ics-btn').addEventListener('click', () => document.getElementById('ics-modal').classList.remove('active'));
    document.getElementById('approve-ics-btn').addEventListener('click', async () => {
        const url = document.getElementById('ics-url-input').value.trim();
        if (!url) {
            const statusDiv = document.getElementById('ics-status');
            if (statusDiv) { statusDiv.innerText = 'אנא הזן קישור תקין.'; statusDiv.style.color = 'var(--danger)'; }
            return;
        }
        await runIcsSync(url, false);
    });
});