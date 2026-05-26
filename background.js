// שעון שמעיר את התוסף פעם בשעה כדי לסנכרן
chrome.alarms.create("moodleSyncAlarm", { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "moodleSyncAlarm") runBackgroundSync();
});

chrome.runtime.onStartup.addListener(runBackgroundSync);
chrome.runtime.onInstalled.addListener(runBackgroundSync);

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

function fireNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        title: title,
        message: message
    });
}

async function runBackgroundSync() {
    const result = await chrome.storage.local.get(['lastIcsUrlPref', 'savedMoodleTasks', 'notifSettingsPref', 'courseAliasesPref', 'recentUpdatesPref']);
    
    if (!result.lastIcsUrlPref || !result.notifSettingsPref || !result.notifSettingsPref.enabled) return;

    const url = result.lastIcsUrlPref;
    let allTasks = result.savedMoodleTasks || [];
    const notifSettings = result.notifSettingsPref;
    const courseAliases = result.courseAliasesPref || {};
    let recentUpdates = result.recentUpdatesPref || [];

    try {
        const response = await fetch(url);
        if (!response.ok) return;
        const icsData = await response.text();
        const events = parseICSData(icsData);

        let isChanged = false;
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
            const courseAllowed = notifSettings.courses[course] !== false;

            if (existingTaskIndex !== -1) {
                const existingTask = allTasks[existingTaskIndex];
                let taskChanged = false;

                if (existingTask.dateStr !== dateStr || existingTask.title !== cleanTitle) {
                    taskChanged = true;
                }

                if (taskChanged) {
                    existingTask.dateStr = dateStr; 
                    existingTask.title = cleanTitle; 
                    existingTask.course = course; 
                    existingTask.url = taskUrl || existingTask.url;
                    isChanged = true;
                    
                    const doneNotice = existingTask.isDone ? " (✅ כבוצעה)" : "";
                    newLogs.push({ type: 'update', text: `[${displayCourseName}] המטלה "${cleanTitle}" עודכנה ל-${dateStr}${doneNotice}` });

                    if (notifSettings.onUpdate && courseAllowed) {
                        fireNotification('Moodle Organizer - עדכון מטלה 🔄', `[${displayCourseName}] ${cleanTitle}\nעודכן ל-${dateStr}`);
                    }
                }
            } else {
                allTasks.push({ id: safeId, title: cleanTitle, course: course, dateStr: dateStr, url: taskUrl, isDone: false, subTasks: [] });
                isChanged = true;
                newLogs.push({ type: 'new', text: `[${displayCourseName}] התווספה הגשה חדשה: ${cleanTitle}` });

                if (notifSettings.onNew && courseAllowed) {
                    fireNotification('Moodle Organizer - מטלה חדשה! ✨', `[${displayCourseName}] ${cleanTitle}\nלמתי? ${dateStr}`);
                }
            }
        });

        if (isChanged) {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const logTimeStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth()+1).padStart(2, '0')} ${timeStr}`;

            newLogs.forEach(log => {
                recentUpdates.unshift({ id: Date.now() + Math.random(), text: log.text, dateStr: logTimeStr, type: log.type });
            });
            recentUpdates = recentUpdates.slice(0, 50);

            chrome.storage.local.set({ 
                savedMoodleTasks: allTasks,
                recentUpdatesPref: recentUpdates,
                lastSyncMsgPref: `עדכון אחרון: ${timeStr} (היו שינויים ברקע)`
            });
        }
    } catch (error) {
        console.error("Moodle background sync failed:", error);
    }
    // הקישור הישיר לקובץ המניפסט בגיטהאב שלך (Raw URL)
const GITHUB_MANIFEST_URL = "https://raw.githubusercontent.com/emmanuelbenchaim-cmd/MoodleExtension/main/MoodleExtensionEBC/manifest.json";

async function checkForUpdates() {
    try {
        // משיכת נתוני הגרסה מהענן
        let response = await fetch(GITHUB_MANIFEST_URL, { cache: "no-store" });
        let remoteManifest = await response.json();
        
        // שליפת הגרסה המותקנת כרגע בדפדפן
        let localVersion = chrome.runtime.getManifest().version;

        // השוואה: אם הגרסה בגיטהאב שונה (חדשה יותר), נקפיץ התרעה
        if (remoteManifest.version !== localVersion) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon.png", // ודא שיש אייקון בנתיב הזה
                title: "עדכון חדש ל-Moodle Organizer Pro!",
                message: `גרסה ${remoteManifest.version} זמינה עכשיו. היכנסו ל-GitHub כדי להוריד את הקבצים החדשים ולהתקין.`
            });
        }
    } catch (error) {
        console.log("שגיאה בבדיקת עדכונים:", error);
    }
}

// הרצת הבדיקה בכל פעם שהדפדפן נפתח/התוסף מתעורר
checkForUpdates();
}