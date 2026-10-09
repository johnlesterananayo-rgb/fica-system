/* FICA frontend integration layer: current backend contract, no mock writes. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const page = document.body.dataset.page || "";
  const STATUSES = ["Enrolled", "Promoted", "Transferred Out", "Dropped", "Graduated"];
  const SUBJECTS = ["Mother Tongue", "Filipino", "English", "Mathematics", "Science", "Araling Panlipunan (AP)", "Edukasyon sa Pagpapakatao (EsP)", "MAPEH", "EPP / TLE"];
  const escHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const showMessage = (message, kind = "info", target = "#page-message") => {
    const node = $(target);
    if (!node) { window.alert(message); return; }
    node.textContent = message;
    node.hidden = false;
    node.classList.remove("error", "success");
    if (kind === "error" || kind === "success") node.classList.add(kind);
  };
  const formMessage = (selector, message, kind = "info") => {
    const node = $(selector);
    if (!node) return;
    node.textContent = message || "";
    node.classList.remove("error", "success");
    if (kind === "error" || kind === "success") node.classList.add(kind);
  };
  const openModal = id => { const n = document.getElementById(id); if (n) n.classList.add("show"); };
  const closeModal = id => { const n = document.getElementById(id); if (n) n.classList.remove("show"); };
  const fmtDate = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"});
  };
  const fmtDateTime = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, {year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});
  };
  const currentSchoolYear = () => {
    const d = new Date();
    const start = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
    return `${start}-${start + 1}`;
  };
  const statusClass = value => String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pill = value => `<span class="status-pill ${statusClass(value)}">${escHtml(value || "Unknown")}</span>`;
  const setButtonBusy = (button, busy, busyText = "Saving…") => {
    if (!button) return;
    if (busy) { button.dataset.originalText = button.textContent; button.textContent = busyText; button.disabled = true; }
    else { button.textContent = button.dataset.originalText || button.textContent; button.disabled = false; }
  };
  async function getAllStudents() {
    const pageSize = 100;
    const first = await api(`/students?page=1&page_size=${pageSize}`);
    const rows = Array.isArray(first.data) ? first.data.slice() : [];
    const pages = Math.ceil((Number(first.total) || rows.length) / pageSize);
    for (let p = 2; p <= Math.min(pages, 100); p++) {
      const result = await api(`/students?page=${p}&page_size=${pageSize}`);
      rows.push(...(Array.isArray(result.data) ? result.data : []));
    }
    return rows;
  }
  function wireModalCloseButtons() {
    $$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
    $$('.popup').forEach(popup => popup.addEventListener('click', event => { if (event.target === popup) popup.classList.remove('show'); }));
  }
  function wireChat() {
    const chat = $('#chatbox');
    if (!chat) return;
    const input = $('.chat-input input', chat);
    const button = $('.send-btn', chat);
    const messages = $('.chat-messages', chat);
    const append = (who, text) => {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${who}: `;
      p.append(strong, document.createTextNode(text));
      messages.appendChild(p);
      messages.scrollTop = messages.scrollHeight;
    };
    const send = () => {
      const text = (input?.value || '').trim();
      if (!text) return;
      append('You', text);
      input.value = '';
      append('AI', 'The assistant panel is visual only and is not connected to an AI backend endpoint yet. Use the page controls to access live FICA data.');
    };
    button?.addEventListener('click', send);
    input?.addEventListener('keydown', event => { if (event.key === 'Enter') send(); });
  }
  function wireTheme() {
    const saved = localStorage.getItem('fica-theme') || 'light';
    if (saved === 'dark') document.body.classList.add('theme-dark');
    const control = $('#theme-select');
    if (control) {
      control.value = saved;
      control.addEventListener('change', () => {
        localStorage.setItem('fica-theme', control.value);
        document.body.classList.toggle('theme-dark', control.value === 'dark');
      });
    }
  }
  function renderStatusBars(container, counts) {
    const items = [
      {label:'Enrolled', value:counts['Enrolled'] || 0, cls:'enrolled'},
      {label:'Promoted', value:counts['Promoted'] || 0, cls:'transferred'},
      {label:'Transferred Out', value:counts['Transferred Out'] || 0, cls:'transferred'},
      {label:'Dropped', value:counts['Dropped'] || 0, cls:'dropout'},
      {label:'Graduated', value:counts['Graduated'] || 0, cls:'dropout'}
    ];
    const max = Math.max(1, ...items.map(item => item.value));
    container.innerHTML = items.map(item => `<div class="bar-row"><span>${escHtml(item.label)}</span><div class="bar-track"><div class="bar-fill ${item.cls}" style="width:${(item.value / max) * 100}%"></div></div><strong>${item.value}</strong></div>`).join('');
  }

  async function loginPage() {
    const form = $('#login-form');
    const message = $('#login-message');
    try {
      const {data} = await fica.auth.getSession();
      if (data?.session) { window.location.href = FICA.HOME_PAGE; return; }
    } catch (_) { /* remain on login page */ }
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      formMessage('#login-message', '');
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      const button = $('#login-submit');
      setButtonBusy(button, true, 'Signing in…');
      try {
        await signIn(email, password);
        window.location.href = FICA.HOME_PAGE;
      } catch (error) {
        formMessage('#login-message', error.message || 'Unable to sign in. Check your credentials.', 'error');
      } finally { setButtonBusy(button, false); }
    });
  }

  async function logoutPage() {
    $('#cancel-logout')?.addEventListener('click', () => { window.location.href = FICA.HOME_PAGE; });
    $('#confirm-logout')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      setButtonBusy(button, true, 'Signing out…');
      try { await signOut(); }
      catch (error) { formMessage('#logout-message', error.message || 'Sign out failed.', 'error'); setButtonBusy(button, false); }
    });
  }

  async function dashboardPage() {
    const [studentsResult, requestsResult, calendarResult, logsResult] = await Promise.allSettled([
      getAllStudents(), api('/requests'), api('/calendar'), api('/logs?limit=10')
    ]);
    const students = studentsResult.status === 'fulfilled' ? studentsResult.value : [];
    const requests = requestsResult.status === 'fulfilled' ? requestsResult.value : [];
    const calendar = calendarResult.status === 'fulfilled' ? calendarResult.value : {milestones:[]};
    const logs = logsResult.status === 'fulfilled' ? logsResult.value : [];
    if ([studentsResult, requestsResult, calendarResult].some(result => result.status === 'rejected')) {
      const failed = [studentsResult, requestsResult, calendarResult].filter(result => result.status === 'rejected')[0];
      showMessage(failed.reason?.message || 'Some dashboard data could not be loaded.', 'error');
    }
    const gradeControl = $('#dashboard-grade');
    const statusControl = $('#dashboard-status');
    const thresholdControl = $('#dashboard-threshold');
    const horizonControl = $('#dashboard-horizon');
    const updateCounts = async () => {
      const matching = students.filter(s => (gradeControl.value === 'all' || s.grade === gradeControl.value) && (statusControl.value === 'all' || s.status === statusControl.value));
      $('#metric-students').textContent = String(matching.length);
      $('#metric-requests').textContent = String(requests.filter(r => r.status === 'Ongoing').length);
      const counts = {};
      matching.forEach(student => { counts[student.status] = (counts[student.status] || 0) + 1; });
      const total = matching.length || 1;
      const enrolledEnd = (counts['Enrolled'] || 0) / total * 100;
      const transferEnd = enrolledEnd + ((counts['Transferred Out'] || 0) / total * 100);
      const droppedEnd = transferEnd + (((counts['Dropped'] || 0) + (counts['Graduated'] || 0) + (counts['Promoted'] || 0)) / total * 100);
      const chart = $('#student-status-chart');
      chart.style.background = matching.length ? `conic-gradient(#007BFF 0% ${enrolledEnd}%, #ffc107 ${enrolledEnd}% ${transferEnd}%, #dc3545 ${transferEnd}% ${Math.min(100,droppedEnd)}%, #e5e7eb ${Math.min(100,droppedEnd)}% 100%)` : '#e5e7eb';
      $('#chart-summary').textContent = `${matching.length} student record(s) in the selected filters.`;
      try {
        const risk = await api(`/analytics/risk?threshold=${encodeURIComponent(thresholdControl.value)}`);
        $('#metric-risk').textContent = String((risk.flags || []).length);
      } catch (error) { $('#metric-risk').textContent = '—'; showMessage(error.message, 'error'); }
    };
    await updateCounts();
    [gradeControl, statusControl, thresholdControl].forEach(control => control.addEventListener('change', updateCounts));
    const renderEvents = calendar.milestones || [];
    const upcoming = renderEvents.filter(item => item.status === 'upcoming' || item.status === 'ongoing');
    $('#metric-events').textContent = String(upcoming.length);
    $('#upcoming-events').innerHTML = upcoming.length ? upcoming.slice(0, 6).map(item => `<li><span class="event-date">${escHtml(item.start_date)}</span><span class="event-description"><strong>${escHtml(item.title)}</strong><br><small>${escHtml(item.description || '')}</small></span>${pill(item.status)}</li>`).join('') : '<li class="empty-state">No upcoming milestones.</li>';
    $('#recent-activity').innerHTML = logs.length ? logs.slice(0, 8).map(item => `<li><strong>${escHtml(item.registrar_name || item.email || 'Registrar')}</strong> — ${escHtml(item.action)}<br><small>${escHtml(fmtDateTime(item.created_at))}</small></li>`).join('') : '<li class="empty-state">No recent activity available.</li>';
    if (logsResult.status === 'rejected') $('#recent-activity').innerHTML = '<li class="empty-state">Activity log endpoint unavailable. Restart the updated backend.</li>';
    const forecast = async () => {
      $('#forecast-summary').textContent = 'Loading forecast…';
      try {
        const result = await api(`/analytics/forecast?years_ahead=${encodeURIComponent(horizonControl.value)}`);
        const rows = result.forecast || [];
        $('#forecast-summary').innerHTML = rows.length ? `<p>Projection for ${escHtml(rows[0].target_school_year)}:</p><div class="table-scroll"><table class="report-table"><thead><tr><th>Grade</th><th>Projected students</th></tr></thead><tbody>${rows.filter(r => r.target_school_year === rows[0].target_school_year).map(r => `<tr><td>${escHtml(r.grade_level)}</td><td>${Number(r.predicted_total) || 0}</td></tr>`).join('')}</tbody></table></div>${(result.meta?.warnings || []).map(w => `<p class="muted">${escHtml(w)}</p>`).join('')}` : '<p>No forecast available. The backend needs enrollment history across school years.</p>';
      } catch (error) { $('#forecast-summary').textContent = error.message || 'Forecast unavailable.'; }
    };
    horizonControl.addEventListener('change', forecast);
    await forecast();
  }

  async function studentsPage() {
    let students = [];
    const tbody = $('#students-body');
    const render = () => {
      const term = $('#student-search').value.trim().toLowerCase();
      const grade = $('#student-grade-filter').value;
      const status = $('#student-status-filter').value;
      const filtered = students.filter(student => {
        const name = `${student.first_name || ''} ${student.last_name || ''}`.trim().toLowerCase();
        return (!term || name.includes(term) || String(student.lrn || '').toLowerCase().includes(term)) && (grade === 'all' || student.grade === grade) && (status === 'all' || student.status === status);
      });
      tbody.innerHTML = filtered.length ? filtered.map(student => `<tr><td>${escHtml(`${student.first_name || ''} ${student.last_name || ''}`.trim())}</td><td>${escHtml(student.lrn)}</td><td>${escHtml(student.grade || '—')}</td><td>${escHtml(student.gender || '—')}</td><td>${pill(student.status)}</td><td><div class="table-actions"><a class="small-btn primary" href="students.profile.html?id=${encodeURIComponent(student.id)}">Profile</a><button class="small-btn danger" type="button" data-archive-student="${escHtml(student.id)}" ${student.is_archived ? 'disabled' : ''}>Archive</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No students match the selected filters.</td></tr>';
      $('#student-count').textContent = `${filtered.length} shown · ${students.length} active record(s) loaded`;
    };
    const reload = async () => { tbody.innerHTML = '<tr><td colspan="6">Loading students…</td></tr>'; students = await getAllStudents(); render(); };
    try { await reload(); }
    catch (error) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Student records could not be loaded.</td></tr>'; showMessage(error.message || 'Failed to load students.', 'error'); }
    ['student-search','student-grade-filter','student-status-filter'].forEach(id => document.getElementById(id).addEventListener(id === 'student-search' ? 'input' : 'change', render));
    $('#open-student-popup').addEventListener('click', () => { $('#student-form').reset(); formMessage('#student-form-message',''); openModal('student-popup'); });
    $('#student-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('#save-student-btn'); setButtonBusy(button, true);
      formMessage('#student-form-message','');
      const body = {
        first_name: $('#student-first-name').value.trim(), last_name: $('#student-last-name').value.trim(),
        lrn: $('#student-lrn').value.trim(), grade: $('#student-grade').value,
        gender: $('#student-gender').value || null, birthdate: $('#student-birthdate').value || null,
        address: $('#student-address').value.trim() || null, section: $('#student-section').value.trim() || null,
        status: $('#student-status').value
      };
      try {
        await api('/students', {method:'POST', body});
        closeModal('student-popup'); showMessage('Student created successfully.', 'success'); await reload();
      } catch (error) { formMessage('#student-form-message', error.message || 'Unable to create student.', 'error'); }
      finally { setButtonBusy(button, false); }
    });
    tbody.addEventListener('click', async event => {
      const button = event.target.closest('[data-archive-student]');
      if (!button) return;
      const id = button.dataset.archiveStudent;
      const record = students.find(s => s.id === id);
      if (!record || !window.confirm(`Archive ${record.first_name} ${record.last_name}? The student record will be retained.`)) return;
      button.disabled = true;
      try { await api(`/students/${encodeURIComponent(id)}/archive`, {method:'POST'}); showMessage('Student archived. The record has not been permanently deleted.', 'success'); await reload(); }
      catch (error) { showMessage(error.message || 'Could not archive student.', 'error'); button.disabled = false; }
    });
  }

  async function studentProfilePage() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) { showMessage('Missing student ID. Select a student from the directory.', 'error'); return; }
    let student = null;
    const schoolYearInput = $('#grades-school-year');
    schoolYearInput.value = currentSchoolYear();
    function populateEdit() {
      $('#edit-first-name').value = student.first_name || '';
      $('#edit-last-name').value = student.last_name || '';
      $('#edit-lrn').value = student.lrn || '';
      $('#edit-grade').value = student.grade || 'Grade 1';
      $('#edit-gender').value = student.gender || '';
      $('#edit-birthdate').value = student.birthdate || '';
      $('#edit-address').value = student.address || '';
      $('#edit-section').value = student.section || '';
      $('#edit-status').value = student.status || 'Enrolled';
    }
    function renderProfile() {
      $('#profile-full-name').textContent = `${student.first_name || ''} ${student.last_name || ''}`.trim();
      $('#profile-lrn').textContent = student.lrn || '—';
      $('#profile-age').textContent = student.age == null ? '—' : String(student.age);
      $('#profile-gender').textContent = student.gender || '—';
      $('#profile-grade').textContent = student.grade || '—';
      $('#profile-section').textContent = student.section || '—';
      $('#profile-status').innerHTML = pill(student.status);
      $('#profile-address').textContent = student.address || '—';
      $('#archive-profile').disabled = !!student.is_archived;
      $('#archive-profile').textContent = student.is_archived ? 'Already Archived' : 'Archive Student';
    }
    async function loadGrades() {
      const year = schoolYearInput.value.trim();
      if (!/^\d{4}-\d{4}$/.test(year)) { showMessage('Enter school year in YYYY-YYYY format.', 'error'); return; }
      try {
        const grades = await api(`/students/${encodeURIComponent(id)}/grades?school_year=${encodeURIComponent(year)}`);
        $$('#grades-body tr').forEach(row => $$('.grades-table td[data-quarter]', row).forEach(cell => { cell.textContent = '—'; }));
        grades.forEach(item => {
          const row = $$("#grades-body tr").find(candidate => candidate.dataset.subject === item.subject);
          const cell = row ? $(`td[data-quarter="${item.quarter}"]`, row) : null;
          if (cell) cell.textContent = item.grade == null ? '—' : String(item.grade);
        });
      } catch (error) { showMessage(error.message || 'Grade records could not be loaded.', 'error'); }
    }
    try { student = await api(`/students/${encodeURIComponent(id)}`); renderProfile(); populateEdit(); await loadGrades(); }
    catch (error) { showMessage(error.message || 'Could not load student profile.', 'error'); return; }
    $('#open-edit-profile').addEventListener('click', () => { populateEdit(); formMessage('#edit-profile-message',''); openModal('edit-profile-popup'); });
    $('#edit-profile-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); setButtonBusy(button, true); formMessage('#edit-profile-message','');
      const body = {
        first_name: $('#edit-first-name').value.trim(), last_name: $('#edit-last-name').value.trim(), lrn: $('#edit-lrn').value.trim(),
        grade: $('#edit-grade').value, gender: $('#edit-gender').value || null, birthdate: $('#edit-birthdate').value || null,
        address: $('#edit-address').value.trim() || null, section: $('#edit-section').value.trim() || null, status: $('#edit-status').value
      };
      try { student = await api(`/students/${encodeURIComponent(id)}`, {method:'PATCH', body}); renderProfile(); closeModal('edit-profile-popup'); showMessage('Student profile updated.', 'success'); }
      catch (error) { formMessage('#edit-profile-message', error.message || 'Could not update profile.', 'error'); }
      finally { setButtonBusy(button, false); }
    });
    $('#open-grade-popup').addEventListener('click', () => { $('#grade-form').reset(); formMessage('#grade-form-message',''); openModal('grade-popup'); });
    $('#grade-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); setButtonBusy(button, true); formMessage('#grade-form-message','');
      const year = schoolYearInput.value.trim();
      const body = {school_year:year, subject:$('#grade-subject').value, quarter:Number($('#grade-quarter').value), grade:Number($('#grade-value').value)};
      if (!/^\d{4}-\d{4}$/.test(year)) { formMessage('#grade-form-message','Use school year format YYYY-YYYY.','error'); setButtonBusy(button,false); return; }
      if (!Number.isFinite(body.grade) || body.grade < 0 || body.grade > 100) { formMessage('#grade-form-message','Grade must be between 0 and 100.','error'); setButtonBusy(button,false); return; }
      try { await api(`/students/${encodeURIComponent(id)}/grades`, {method:'POST', body}); closeModal('grade-popup'); await loadGrades(); showMessage('Grade saved successfully.', 'success'); }
      catch (error) { formMessage('#grade-form-message', error.message || 'Could not save grade.', 'error'); }
      finally { setButtonBusy(button, false); }
    });
    schoolYearInput.addEventListener('change', loadGrades);
    $('#archive-profile').addEventListener('click', async () => {
      if (student.is_archived || !window.confirm(`Archive ${student.first_name} ${student.last_name}?`)) return;
      try { await api(`/students/${encodeURIComponent(id)}/archive`, {method:'POST'}); window.location.href = 'student.html'; }
      catch (error) { showMessage(error.message || 'Could not archive student.', 'error'); }
    });
  }

  async function requestPage() {
    let students = [], types = [], requests = [];
    const tbody = $('#request-table-body');
    const reload = async () => { requests = await api('/requests'); render(); };
    const render = () => {
      const filter = $('#request-status-filter').value;
      const rows = requests.filter(row => filter === 'all' || row.status === filter);
      tbody.innerHTML = rows.length ? rows.map(row => {
        const terminal = row.status !== 'Ongoing';
        const shortId = String(row.id || '').slice(0, 8).toUpperCase();
        return `<tr><td title="${escHtml(row.id)}">${escHtml(shortId)}</td><td>${escHtml(row.student_name || 'Student archived/unavailable')}<br><small>${escHtml(row.student_lrn || '')}</small></td><td>${escHtml(row.type_name || 'Unknown type')}</td><td>${escHtml(fmtDate(row.created_at))}</td><td>${pill(row.priority)}</td><td>${pill(row.status)}</td><td><div class="table-actions"><button class="small-btn success" data-request-status="Completed" data-request-id="${escHtml(row.id)}" ${terminal ? 'disabled' : ''}>Complete</button><button class="small-btn danger" data-request-status="Removed" data-request-id="${escHtml(row.id)}" ${terminal ? 'disabled' : ''}>Remove</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="7" class="empty-state">No requests found for this filter.</td></tr>';
    };
    try {
      [students, types] = await Promise.all([getAllStudents(), api('/request-types')]);
      $('#request-student').innerHTML = '<option value="">Select a student</option>' + students.map(student => `<option value="${escHtml(student.id)}">${escHtml(`${student.first_name} ${student.last_name}`)} — ${escHtml(student.lrn)}</option>`).join('');
      $('#request-type').innerHTML = '<option value="">Select request type</option>' + types.map(type => `<option value="${escHtml(type.id)}">${escHtml(type.type_name)}</option>`).join('');
      await reload();
    } catch (error) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Requests could not be loaded.</td></tr>'; showMessage(error.message || 'Failed to load request data.', 'error'); }
    $('#request-status-filter').addEventListener('change', render);
    $('#open-request-popup').addEventListener('click', () => { $('#request-form').reset(); formMessage('#request-form-message',''); openModal('request-popup'); });
    $('#request-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = $('#save-request-btn'); setButtonBusy(button,true); formMessage('#request-form-message','');
      const body = {student_id:$('#request-student').value, record_type_id:Number($('#request-type').value), priority:$('#request-priority').value, remarks:$('#request-remarks').value.trim() || null};
      if (!body.student_id || !Number.isInteger(body.record_type_id)) { formMessage('#request-form-message','Select a student and request type.','error'); setButtonBusy(button,false); return; }
      try { await api('/requests',{method:'POST',body}); closeModal('request-popup'); showMessage('Request created successfully.','success'); await reload(); }
      catch (error) { formMessage('#request-form-message',error.message || 'Could not create request.','error'); }
      finally { setButtonBusy(button,false); }
    });
    tbody.addEventListener('click', async event => {
      const button = event.target.closest('[data-request-status]'); if (!button || button.disabled) return;
      const {requestId, requestStatus} = button.dataset;
      if (!window.confirm(`Change this request status to ${requestStatus}?`)) return;
      button.disabled = true;
      try { await api(`/requests/${encodeURIComponent(requestId)}/status`,{method:'PATCH',body:{status:requestStatus}}); showMessage(`Request marked ${requestStatus.toLowerCase()}.`,'success'); await reload(); }
      catch (error) { showMessage(error.message || 'Could not update request.','error'); button.disabled = false; }
    });
  }

  async function calendarPage() {
    let cursor = new Date(); cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    let milestones = [];
    const loadYear = async () => {
      try { const data = await api(`/calendar?year=${cursor.getFullYear()}`); milestones = data.milestones || []; render(); }
      catch (error) { showMessage(error.message || 'Could not load calendar.','error'); }
    };
    const render = () => {
      $('#calendar-month-title').textContent = cursor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
      const grid = $('#calendar-days');
      const firstDay = new Date(cursor.getFullYear(),cursor.getMonth(),1).getDay();
      const totalDays = new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate();
      const currentMonthEvents = milestones.filter(m => {
        const start = new Date(`${m.start_date}T00:00:00`), end = new Date(`${m.end_date}T23:59:59`);
        const mStart = new Date(cursor.getFullYear(),cursor.getMonth(),1), mEnd = new Date(cursor.getFullYear(),cursor.getMonth()+1,0,23,59,59);
        return start <= mEnd && end >= mStart;
      });
      let html = '';
      for (let i=0;i<firstDay;i++) html += '<div class="day empty" aria-hidden="true"></div>';
      const today = new Date();
      for (let day=1;day<=totalDays;day++) {
        const date = new Date(cursor.getFullYear(),cursor.getMonth(),day);
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const hits = currentMonthEvents.filter(m => m.start_date <= iso && m.end_date >= iso);
        const isToday = date.toDateString() === today.toDateString();
        html += `<div class="day ${isToday?'today':''} ${hits.length?'has-event':''}" title="${hits.map(m => escHtml(m.title)).join(', ')}"><span>${day}</span>${hits.slice(0,2).map(m=>`<span class="event">${escHtml(m.title)}</span>`).join('')}</div>`;
      }
      const blanks = (7 - ((firstDay+totalDays) % 7)) % 7;
      for (let i=0;i<blanks;i++) html += '<div class="day empty" aria-hidden="true"></div>';
      grid.innerHTML = html;
      const body = $('#events-body');
      const relevant = currentMonthEvents.sort((a,b)=>a.start_date.localeCompare(b.start_date));
      body.innerHTML = relevant.length ? relevant.map(m=>`<tr><td>${escHtml(m.date_label || fmtDate(m.start_date))}</td><td><strong>${escHtml(m.title)}</strong></td><td>${escHtml(m.description || '')}</td><td>${pill(m.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No configured milestones in this month.</td></tr>';
    };
    $('#calendar-prev').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(),cursor.getMonth()-1,1); await loadYear(); });
    $('#calendar-next').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(),cursor.getMonth()+1,1); await loadYear(); });
    $('#refresh-calendar').addEventListener('click', loadYear);
    await loadYear();
  }

  async function logsPage() {
    const tbody = $('#logs-table-body');
    const load = async () => {
      tbody.innerHTML = '<tr><td colspan="4">Loading activity logs…</td></tr>';
      try {
        const rows = await api('/logs?limit=100');
        tbody.innerHTML = rows.length ? rows.map(row => `<tr><td>${escHtml(row.id)}</td><td>${escHtml(row.registrar_name || row.email || row.registrar_id || 'Unknown user')}</td><td>${escHtml(row.action)}</td><td>${escHtml(fmtDateTime(row.created_at))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No activity logs have been recorded yet.</td></tr>';
      } catch (error) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Could not load activity logs.</td></tr>'; showMessage(error.message || 'Log request failed.','error'); }
    };
    $('#refresh-logs').addEventListener('click', load);
    await load();
  }

  async function reportsPage() {
    const container = $('#report-status-chart');
    let students = [];
    try {
      [students] = await Promise.all([getAllStudents()]);
      const counts = {}; students.forEach(student => { counts[student.status] = (counts[student.status] || 0) + 1; });
      renderStatusBars(container, counts);
      $('#report-status-summary').textContent = `${students.length} active student record(s) returned by the backend.`;
    } catch (error) { container.textContent = 'Could not load student data.'; showMessage(error.message || 'Student data failed to load.','error'); }
    const loadRisk = async () => {
      $('#risk-results').textContent = 'Loading risk analysis…';
      try {
        const data = await api('/analytics/risk?threshold=0.85');
        $('#risk-results').innerHTML = data.flags?.length ? `<p>${data.flags.length} grade level(s) are below the selected 85% retention threshold.</p><ul>${data.flags.map(flag=>`<li><strong>${escHtml(flag.grade_level)}</strong> — retention ${(Number(flag.retention_rate)*100).toFixed(1)}%, attrition ${(Number(flag.attrition_rate)*100).toFixed(1)}%. ${escHtml(flag.recommendation)}</li>`).join('')}</ul>` : `<p>No grade levels are below the 85% threshold in the available enrollment history.</p><p class="muted">Year-to-year pairs used: ${Number(data.year_pairs_used)||0}.</p>`;
      } catch (error) { $('#risk-results').textContent = error.message || 'Risk analysis unavailable.'; }
    };
    const loadForecast = async () => {
      $('#forecast-results').textContent = 'Loading enrollment forecast…';
      try {
        const data = await api(`/analytics/forecast?years_ahead=${encodeURIComponent($('#report-forecast-years').value)}`);
        const rows = data.forecast || [];
        $('#forecast-results').innerHTML = rows.length ? `<div class="table-scroll"><table class="report-table"><thead><tr><th>Target School Year</th><th>Grade Level</th><th>Projected Students</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escHtml(row.target_school_year)}</td><td>${escHtml(row.grade_level)}</td><td>${Number(row.predicted_total)||0}</td></tr>`).join('')}</tbody></table></div>${(data.meta?.warnings || []).map(w=>`<p class="muted">${escHtml(w)}</p>`).join('')}` : '<p>No forecast available. At least one enrollment year is required, and multiple years improve estimates.</p>';
      } catch (error) { $('#forecast-results').textContent = error.message || 'Forecast unavailable.'; }
    };
    await Promise.all([loadRisk(), loadForecast()]);
    $('#report-forecast-years').addEventListener('change', loadForecast);
  }

  async function settingsPage() {
    wireTheme();
    let currentEmail = '';
    try { const {data,error} = await fica.auth.getUser(); if (error) throw error; currentEmail = data.user?.email || ''; $('#account-email').textContent = currentEmail || 'Unavailable'; $('#reset-email').value = currentEmail; }
    catch (error) { $('#account-email').textContent = 'Unavailable'; showMessage(error.message || 'Could not read account details.','error'); }
    $('#open-change-email').addEventListener('click', () => { $('#new-email').value = currentEmail; formMessage('#email-form-message',''); openModal('change-email-popup'); });
    $('#open-change-password').addEventListener('click', () => { $('#change-password-form').reset(); formMessage('#password-form-message',''); openModal('change-password-popup'); });
    $('#open-reset-password').addEventListener('click', () => { $('#reset-email').value = currentEmail; formMessage('#forgot-form-message',''); openModal('forgot-popup'); });
    $('#open-settings-logout').addEventListener('click', () => openModal('logout-popup'));
    $('#confirm-settings-logout').addEventListener('click', async buttonEvent => { const button=buttonEvent.currentTarget; setButtonBusy(button,true,'Signing out…'); try { await signOut(); } catch(error) { showMessage(error.message || 'Could not sign out.','error'); setButtonBusy(button,false); } });
    $('#change-email-form').addEventListener('submit', async event => {
      event.preventDefault(); const button=$('button[type="submit"]',event.currentTarget); setButtonBusy(button,true,'Sending…'); formMessage('#email-form-message','');
      try { const {error}=await fica.auth.updateUser({email:$('#new-email').value.trim()}); if(error) throw error; formMessage('#email-form-message','Email-change request submitted. Follow the confirmation instructions sent by Supabase.','success'); }
      catch(error) { formMessage('#email-form-message',error.message || 'Email update failed.','error'); }
      finally { setButtonBusy(button,false); }
    });
    $('#change-password-form').addEventListener('submit', async event => {
      event.preventDefault(); const button=$('button[type="submit"]',event.currentTarget); setButtonBusy(button,true,'Updating…'); formMessage('#password-form-message','');
      const oldPassword=$('#old-password').value, newPassword=$('#new-password').value, confirmPassword=$('#confirm-password').value;
      if(newPassword !== confirmPassword) { formMessage('#password-form-message','New password and confirmation do not match.','error'); setButtonBusy(button,false); return; }
      if(newPassword.length < 8) { formMessage('#password-form-message','Use at least 8 characters for the new password.','error'); setButtonBusy(button,false); return; }
      try {
        if(!currentEmail) throw new Error('Unable to determine the signed-in email address.');
        const authResult=await fica.auth.signInWithPassword({email:currentEmail,password:oldPassword});
        if(authResult.error) throw new Error('Current password is incorrect.');
        const updated=await fica.auth.updateUser({password:newPassword}); if(updated.error) throw updated.error;
        formMessage('#password-form-message','Password updated successfully.','success'); $('#change-password-form').reset();
      } catch(error) { formMessage('#password-form-message',error.message || 'Password update failed.','error'); }
      finally { setButtonBusy(button,false); }
    });
    $('#forgot-form').addEventListener('submit', async event => {
      event.preventDefault(); const button=$('button[type="submit"]',event.currentTarget); setButtonBusy(button,true,'Sending…'); formMessage('#forgot-form-message','');
      try { const email=$('#reset-email').value.trim(); const {error}=await fica.auth.resetPasswordForEmail(email,{redirectTo:window.location.href.split('#')[0]}); if(error) throw error; formMessage('#forgot-form-message','If the account is eligible, Supabase will send a password reset link. Complete the reset using the email link.','success'); }
      catch(error) { formMessage('#forgot-form-message',error.message || 'Could not send reset link.','error'); }
      finally { setButtonBusy(button,false); }
    });
    $('#recovery-form').addEventListener('submit', async event => {
      event.preventDefault(); const button=$('button[type="submit"]',event.currentTarget); setButtonBusy(button,true,'Updating…'); formMessage('#recovery-form-message','');
      const p1=$('#recovery-password').value, p2=$('#recovery-confirm-password').value;
      if(p1.length<8 || p1!==p2) { formMessage('#recovery-form-message',p1!==p2?'Passwords do not match.':'Password must be at least 8 characters.','error'); setButtonBusy(button,false); return; }
      try { const {error}=await fica.auth.updateUser({password:p1}); if(error) throw error; formMessage('#recovery-form-message','Password reset successfully.','success'); setTimeout(()=>closeModal('recovery-popup'),700); }
      catch(error) { formMessage('#recovery-form-message',error.message || 'Could not update password.','error'); }
      finally { setButtonBusy(button,false); }
    });
    fica.auth.onAuthStateChange(event => { if(event==='PASSWORD_RECOVERY') openModal('recovery-popup'); });
    const {data:sessionData}=await fica.auth.getSession();
    if(window.location.hash.includes('type=recovery') || sessionData?.session?.user?.recovery_sent_at) openModal('recovery-popup');
  }

  async function run() {
    wireModalCloseButtons();
    if (page === 'login') return loginPage();
    if (page === 'logout') return logoutPage();
    const session = await initPage();
    if (!session) return;
    wireChat();
    const handlers = {
      dashboard: dashboardPage,
      student: studentsPage,
      'student-profile': studentProfilePage,
      request: requestPage,
      calendar: calendarPage,
      logs: logsPage,
      reports: reportsPage,
      settings: settingsPage
    };
    try {
      if (handlers[page]) await handlers[page]();
    } catch (error) {
      showMessage(error?.message || 'Unexpected page error.','error');
      console.error(`FICA ${page} page error`, error);
    }
  }
  document.addEventListener('DOMContentLoaded', run);
})();
