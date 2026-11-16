#!/usr/bin/env python3
"""pe: helper commands for the /enhance-prompt skill.

  pe start  --session ID [--prefill TEXT]       open the popup and wait; prints what the enhancer needs
  pe wait   --job DIR                          keep waiting for a popup that is still open (no time limit)
  pe finish --job DIR --model M --effort E      read the result from stdin, save it, open the result window
  pe fail   --job DIR --error MESSAGE           show an error in the result window (nothing saved as a prompt)
  pe show   --session ID [--n N]                reopen the result window for a saved prompt
  pe cleanup                                    delete thread folders unused for more than 30 days

Data lives in ~/.claude/prompt-enhancer/<date>_<session id>/ : one prompt-NN.json per prompt
(all its versions inside) and an img/ folder.
"""
import argparse, datetime, glob, json, os, re, shutil, signal, subprocess, sys, time

HOME = os.path.expanduser('~')
ROOT = os.path.join(HOME, '.claude', 'prompt-enhancer')
SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(SKILL, 'build', 'EnhancePrompt.app', 'Contents', 'MacOS', 'EnhancePrompt')
UI = os.path.join(SKILL, 'ui')
PIDFILE = os.path.join(ROOT, '.popup.pid')
CONFIG = os.path.join(ROOT, 'config.json')
THREAD_RE = re.compile(r'^\d{4}-\d{2}-\d{2}_[A-Za-z0-9-]+$')
KEEP_DAYS = 30


def out(s=''):
    sys.stdout.write(s + '\n')


def read_json(p, default=None):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def write_json(p, obj):
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


# ---------------- cleanup ----------------
def newest_mtime(d):
    newest = os.path.getmtime(d)
    for base, dirs, files in os.walk(d):
        for name in files + dirs:
            try:
                newest = max(newest, os.path.getmtime(os.path.join(base, name)))
            except OSError:
                pass
    return newest


def cleanup(root=ROOT, days=KEEP_DAYS, now=None):
    """Delete thread folders (and only those) whose newest file is older than `days`."""
    now = now or time.time()
    removed = []
    if not os.path.isdir(root):
        return removed
    for name in os.listdir(root):
        p = os.path.join(root, name)
        if not THREAD_RE.match(name) or not os.path.isdir(p) or os.path.islink(p):
            continue
        if now - newest_mtime(p) > days * 86400:
            shutil.rmtree(p, ignore_errors=True)
            removed.append(name)
    return removed


# ---------------- threads / records ----------------
def safe_session(s):
    s = re.sub(r'[^A-Za-z0-9-]', '', s or '')
    return s or 'no-session'


def thread_dir(session, create=True):
    sid = safe_session(session)
    found = sorted(glob.glob(os.path.join(ROOT, '*_' + sid)))
    found = [f for f in found if THREAD_RE.match(os.path.basename(f))]
    if found:
        return found[-1]
    d = os.path.join(ROOT, datetime.date.today().isoformat() + '_' + sid)
    if create:
        os.makedirs(os.path.join(d, 'img'), exist_ok=True)
    return d


def records(tdir):
    recs = []
    for p in glob.glob(os.path.join(tdir, 'prompt-*.json')):
        r = read_json(p)
        if r and r.get('versions'):
            recs.append((p, r))
    return sorted(recs, key=lambda x: x[1].get('n', 0))


def latest_ok(r):
    for v in reversed(r['versions']):
        if not v.get('error'):
            return v
    return None


def config():
    return read_json(CONFIG, {}) or {}


SETTINGS = os.path.join(ROOT, 'settings.json')


def settings():
    return read_json(SETTINGS, {}) or {}


# ---------------- app ----------------
def ensure_app():
    srcs = [os.path.join(SKILL, 'app', f) for f in ('main.swift', 'make_icon.swift', 'Info.plist')]
    if not os.path.exists(APP) or any(os.path.exists(f) and os.path.getmtime(f) > os.path.getmtime(APP) for f in srcs):
        r = subprocess.run([os.path.join(SKILL, 'app', 'build.sh')], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(APP):
            raise RuntimeError('could not build the popup app: ' + (r.stderr or r.stdout)[-600:])


def popup_running():
    """PID of a popup that is really still open; a leftover file from a killed run is removed."""
    try:
        pid = int(open(PIDFILE).read().strip())
    except Exception:
        return None
    try:
        comm = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
    except Exception:
        comm = ''
    if 'EnhancePrompt' in comm and ' popup ' in comm + ' ':
        return pid
    try:
        os.remove(PIDFILE)
    except OSError:
        pass
    return None


def open_result(record_path, version):
    if os.environ.get('PE_NO_OPEN'):
        return
    ensure_app()
    # Started through macOS like the popup, so permissions (Accessibility for Paste to chat) are its own.
    subprocess.run(['open', '-n', os.path.join(SKILL, 'build', 'EnhancePrompt.app'), '--args', 'result', '--ui', UI,
                    '--record', record_path, '--version', str(version)],
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------------- conversation context (WC) ----------------
def conversation_context(session, limit_chars=8000, max_msgs=14):
    sid = safe_session(session)
    files = glob.glob(os.path.join(HOME, '.claude', 'projects', '*', sid + '.jsonl'))
    if not files:
        return None
    msgs = []
    try:
        with open(max(files, key=os.path.getmtime), encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get('isMeta') or o.get('isSidechain'):
                    continue
                m = o.get('message') or {}
                role = m.get('role')
                if role not in ('user', 'assistant'):
                    continue
                c = m.get('content')
                parts = []
                if isinstance(c, str):
                    parts.append(c)
                elif isinstance(c, list):
                    for b in c:
                        if isinstance(b, dict) and b.get('type') == 'text':
                            parts.append(b.get('text', ''))
                text = '\n'.join(p for p in parts if p).strip()
                # Drop pasted page-element dumps and system notes, and keep each message short.
                text = re.sub(r'<(launch-selected-element|system-reminder|artifact-view-context)[\s\S]*?</\1>', '', text).strip()
                if len(text) > 1500:
                    text = text[:1500] + ' …'
                if not text or '<command-name>' in text or text.startswith('<local-command') or 'enhance-prompt' in text[:200]:
                    continue
                if text.startswith('<system-reminder>'):
                    continue
                msgs.append(('User' if role == 'user' else 'Claude') + ': ' + text)
    except OSError:
        return None
    msgs = msgs[-max_msgs:]
    out_txt = '\n\n'.join(msgs)
    if len(out_txt) > limit_chars:
        out_txt = '…' + out_txt[-limit_chars:]
    return out_txt


# ---------------- commands ----------------
APP_BUNDLE = os.path.join(SKILL, 'build', 'EnhancePrompt.app')
DEFAULT_WAIT = int(os.environ.get("PE_WAIT_SECONDS", "560"))
WAIT_SECONDS = DEFAULT_WAIT   # one wait round; Claude's command tool allows 10 minutes per call


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def pending_job(tdir):
    """A job that was sent but never handed to the enhancer (e.g. Send happened between two waits)."""
    for j in sorted(glob.glob(os.path.join(tdir, 'jobs', '*'))):
        if os.path.exists(os.path.join(j, 'job.json')) and read_file(os.path.join(j, 'status')) == 'sent' and not os.path.exists(os.path.join(j, 'handed')):
            return j
    return None


def read_file(p):
    try:
        return open(p, encoding='utf-8').read().strip()
    except Exception:
        return None


def cmd_start(a):
    os.makedirs(ROOT, exist_ok=True)
    cleanup()
    ensure_app()
    tdir = thread_dir(a.session)
    pend = pending_job(tdir)
    if pend:
        return emit(pend, a.session)
    other = popup_running()
    if other:
        try:
            os.kill(other, signal.SIGUSR1)
        except OSError:
            pass
        out('STATUS: ALREADY_OPEN')
        out('A popup is already open; it was brought to the front.')
        return 0
    recs = records(tdir)
    prompts = []
    for p, r in recs:
        v = latest_ok(r)
        if v:
            prompts.append({'n': r['n'], 'v': v['v'], 'text': v.get('text', ''), 'model': v.get('model', ''), 'effort': v.get('effort', '')})
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    job = os.path.join(tdir, 'jobs', stamp)
    os.makedirs(job, exist_ok=True)
    draft_dir = os.path.join(tdir, 'draft')
    draft = read_json(os.path.join(draft_dir, 'draft.json'))
    state = {'prompts': prompts, 'wc': False, 'draft': draft, 'prefill': (a.prefill or '').strip(), 'session': a.session,
             'settings': settings()}
    state_file = os.path.join(job, 'state.json')
    write_json(state_file, state)
    touch(os.path.join(job, 'heartbeat'))
    extra = ['--test-js', os.environ['PE_TEST_JS']] if os.environ.get('PE_TEST_JS') else []
    # Started through macOS (open), so the popup is its own app: macOS asks for the microphone
    # in its name, and it is not tied to Claude's 10-minute command limit.
    subprocess.run(['open', '-n'] + (['-g'] if os.environ.get('PE_BACKGROUND') else []) + [APP_BUNDLE, '--args', 'popup', '--ui', UI,
                    '--job', job, '--state', state_file, '--draft', draft_dir] + extra,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wait_and_emit(job, a.session)


def cmd_wait(a):
    st = read_json(os.path.join(a.job, 'state.json')) or {}
    return wait_and_emit(a.job, st.get('session', ''))


def touch(p):
    with open(p, 'a'):
        os.utime(p, None)


def wait_and_emit(job, session):
    stopped = {'v': False}

    def stop(*_):
        stopped['v'] = True
        touch(os.path.join(job, 'stop'))      # the popup closes and keeps the draft
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    t0 = time.time(); pid = None; last_beat = 0
    while True:
        now = time.time()
        if now - last_beat > 2:
            touch(os.path.join(job, 'heartbeat')); last_beat = now
        status = read_file(os.path.join(job, 'status'))
        if status:
            break
        if pid is None:
            v = read_file(os.path.join(job, 'app.pid'))
            if v and v.isdigit():
                pid = int(v)
                with open(PIDFILE, 'w') as f:
                    f.write(str(pid))
            elif now - t0 > 25:
                status = 'error'; break
        elif not pid_alive(pid):
            time.sleep(0.5)
            status = read_file(os.path.join(job, 'status')) or 'error'
            break
        if stopped['v'] and now - t0 > 0:
            # give the popup a moment to save the draft, then leave
            for _ in range(10):
                if read_file(os.path.join(job, 'status')):
                    break
                time.sleep(0.3)
            out('STATUS: CANCELLED')
            out('Stopped; the popup was closed and the draft kept.')
            sys.exit(130)
        if now - t0 > WAIT_SECONDS:
            out('STATUS: STILL_OPEN')
            out('JOB: ' + job)
            out('The popup is still open (the user is still writing). Run this again to keep waiting:')
            out(os.path.join(SKILL, 'bin', 'pe') + ' wait --job "' + job + '"' + ('' if WAIT_SECONDS == DEFAULT_WAIT else ' --wait-seconds %d' % WAIT_SECONDS))
            return 0
        time.sleep(0.4)
    try:
        if read_file(PIDFILE) == str(pid):
            os.remove(PIDFILE)
    except OSError:
        pass
    if status == 'cancelled':
        shutil.rmtree(job, ignore_errors=True)
        out('STATUS: CANCELLED')
        out('The user closed the popup without sending (their draft is saved for next time).')
        return 0
    if status != 'sent' or not os.path.exists(os.path.join(job, 'job.json')):
        out('STATUS: ERROR')
        out('The popup closed without returning a prompt. Any draft was kept for next time.')
        return 0
    return emit(job, session)


def emit(job, session):
    tdir = os.path.dirname(os.path.dirname(job))
    recs = records(tdir)
    jobj = read_json(os.path.join(job, 'job.json')) or {}
    touch(os.path.join(job, 'handed'))
    shutil.rmtree(os.path.join(tdir, 'draft'), ignore_errors=True)
    text = (jobj.get('text') or '').strip()
    with open(os.path.join(job, 'draft.txt'), 'w', encoding='utf-8') as f:
        f.write(text + '\n')
    revise = jobj.get('revise')
    base_rec = None
    if revise:
        for p, r in recs:
            if r['n'] == revise:
                base_rec = (p, r)
    lines = ['STATUS: OK', 'JOB: ' + job]
    if base_rec:
        v = latest_ok(base_rec[1])
        with open(os.path.join(job, 'revise_base.txt'), 'w', encoding='utf-8') as f:
            f.write((v or {}).get('text', '') + '\n')
        lines.append('REQUEST: revise prompt #%d (new version v%d). The draft is the user\'s feedback.' % (revise, len(base_rec[1]['versions']) + 1))
        lines.append('REVISE_BASE_FILE: ' + os.path.join(job, 'revise_base.txt') + '   (last enhanced prompt, including the user\'s own edits)')
        if v:
            lines.append('PREVIOUS_MODEL: %s/%s' % (v.get('model', '?'), v.get('effort', '?')))
    else:
        nxt = max([r['n'] for _, r in recs] + [0]) + 1
        lines.append('REQUEST: new prompt (#%d)' % nxt)
    lines.append('DRAFT_FILE: ' + os.path.join(job, 'draft.txt'))
    if jobj.get('wc'):
        ctx = conversation_context(session)
        if ctx:
            with open(os.path.join(job, 'context.txt'), 'w', encoding='utf-8') as f:
                f.write(ctx + '\n')
            lines.append('CONTEXT_FILE: ' + os.path.join(job, 'context.txt') + '   (recent messages of the conversation; WC is on)')
        else:
            lines.append('CONTEXT: WC is on but the conversation could not be found; enhance without it.')
            with open(os.path.join(job, 'notice.txt'), 'w') as f:
                f.write("WC was on, but this conversation's messages could not be found, so it was enhanced without them.")
    else:
        lines.append('CONTEXT: off (WC not selected)')
    imgs = jobj.get('images') or []
    if imgs:
        lines.append('IMAGES (numbered as the user sees them):')
        for i, im in enumerate(imgs, 1):
            if im.get('edited'):
                lines.append('  image %d: %s  (marked up by the user; the original is %s)' % (i, im['edited'], im['file']))
            else:
                lines.append('  image %d: %s' % (i, im['file']))
    else:
        lines.append('IMAGES: none')
    lines.append('DRAFT (also in DRAFT_FILE):')
    lines.append(text)
    out('\n'.join(lines))
    return 0


def parse_result(raw):
    secs = {}
    cur = None
    for line in raw.replace('\r\n', '\n').split('\n'):
        m = re.match(r'^\s*===\s*(ENHANCED|CHANGES|GAPS|END)\s*===\s*$', line)
        if m:
            cur = m.group(1)
            if cur == 'END':
                break
            secs[cur] = []
            continue
        if cur:
            secs[cur].append(line)
    enh = '\n'.join(secs.get('ENHANCED', [])).strip()
    enh = re.sub(r'^```[a-zA-Z]*\n([\s\S]*?)\n```$', r'\1', enh).strip()

    def items(name):
        res = []
        for l in secs.get(name, []):
            l = re.sub(r'^\s*(?:[-*•]|\d+[.)])\s*', '', l).strip()
            if l and l.lower() not in ('none', 'n/a', '(none)'):
                res.append(l)
        return res
    return enh, items('CHANGES'), items('GAPS')


def save_version(job, model, effort, enhanced, changes, gaps, error=None):
    jobj = read_json(os.path.join(job, 'job.json')) or {}
    tdir = os.path.dirname(os.path.dirname(job))
    os.makedirs(os.path.join(tdir, 'img'), exist_ok=True)
    recs = records(tdir)
    revise = jobj.get('revise')
    target = None
    if revise:
        for p, r in recs:
            if r['n'] == revise:
                target = (p, r)
    if target:
        path, rec = target
    else:
        n = max([r['n'] for _, r in recs] + [0]) + 1
        path = os.path.join(tdir, 'prompt-%02d.json' % n)
        rec = {'n': n, 'created': datetime.datetime.now().isoformat(timespec='seconds'), 'versions': []}
    v = len(rec['versions']) + 1
    images = []
    for i, im in enumerate(jobj.get('images') or [], 1):
        entry = {}
        for key, suffix in (('file', ''), ('edited', '.edited')):
            src = im.get(key)
            if src and os.path.exists(src):
                ext = os.path.splitext(src)[1] or '.png'
                name = 'p%02d-v%d-%d%s%s' % (rec['n'], v, i, suffix, ext)
                shutil.move(src, os.path.join(tdir, 'img', name))
                entry['orig' if key == 'file' else 'edited'] = 'img/' + name
        if entry.get('orig'):
            entry['use_edited'] = True
            images.append(entry)
    if revise and not images and target:
        prev = latest_ok(target[1])
        if prev:
            images = [dict(x) for x in prev.get('images', [])]
    now = datetime.datetime.now()
    ver = {'v': v, 'time': now.isoformat(timespec='seconds'), 'time_label': now.strftime('%-I:%M %p'),
           'draft': (jobj.get('text') or '').strip(), 'revise_of': ({'n': revise} if revise else None),
           'wc': bool(jobj.get('wc')), 'images': images, 'model': model, 'effort': effort,
           'model_text': enhanced, 'text': enhanced, 'changes': changes, 'gaps': gaps}
    notice = os.path.join(job, 'notice.txt')
    if os.path.exists(notice):
        ver['notice'] = open(notice).read().strip()
        ver['notes'] = [ver['notice']]
    if error:
        ver['error'] = error
    rec['versions'].append(ver)
    write_json(path, rec)
    return path, rec['n'], v


def cmd_finish(a):
    raw = sys.stdin.read()
    enhanced, changes, gaps = parse_result(raw)
    if not os.path.exists(os.path.join(a.job, 'job.json')):
        # Already saved (the job folder is removed after saving): nothing to do.
        out('ALREADY_SAVED: this job was already saved; nothing changed.')
        return 0
    if not enhanced:
        return cmd_fail(argparse.Namespace(job=a.job, error='The enhancer returned no ===ENHANCED=== section.\n\nRaw output:\n' + raw[:4000]))
    path, n, v = save_version(a.job, a.model, a.effort, enhanced, changes, gaps)
    shutil.rmtree(a.job, ignore_errors=True)
    open_result(path, v)
    out('DONE: saved prompt #%d v%d and opened the result window.' % (n, v))
    return 0


def cmd_fail(a):
    # Errors only appear in the result window; they are not saved as a prompt.
    job = a.job
    if not os.path.exists(os.path.join(job, 'job.json')):
        out('ALREADY_SAVED: this job was already saved; no error shown.')
        return 0
    jobj = read_json(os.path.join(job, 'job.json')) or {}
    rec = {'n': jobj.get('revise') or 0, 'versions': [{'v': 1, 'draft': jobj.get('text', ''), 'images': [], 'model': '', 'effort': '',
                                                       'text': '', 'error': 'Sorry, the enhancement failed.\n\n' + (a.error or 'Unknown error')}]}
    os.makedirs(job, exist_ok=True)
    path = os.path.join(job, 'error.json')
    write_json(path, rec)
    open_result(path, 1)
    out('SHOWN: the error is displayed in the result window.')
    return 0


def cmd_show(a):
    tdir = thread_dir(a.session, create=False)
    recs = records(tdir) if os.path.isdir(tdir) else []
    if not recs:
        out('No saved prompts for this conversation.')
        return 0
    p, r = recs[-1]
    if a.n:
        for pp, rr in recs:
            if rr['n'] == a.n:
                p, r = pp, rr
    open_result(p, r['versions'][-1]['v'])
    out('Opened prompt #%d.' % r['n'])
    return 0


def main():
    ap = argparse.ArgumentParser(prog='pe')
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('start'); s.add_argument('--session', required=True); s.add_argument('--prefill', default='')
    s.add_argument('--wait-seconds', type=int, default=0)   # shorter wait rounds for tools with shorter command limits
    f = sub.add_parser('finish'); f.add_argument('--job', required=True); f.add_argument('--model', required=True); f.add_argument('--effort', required=True)
    wt = sub.add_parser('wait'); wt.add_argument('--job', required=True); wt.add_argument('--wait-seconds', type=int, default=0)
    x = sub.add_parser('fail'); x.add_argument('--job', required=True); x.add_argument('--error', required=True)
    w = sub.add_parser('show'); w.add_argument('--session', required=True); w.add_argument('--n', type=int, default=0)
    sub.add_parser('cleanup')
    a = ap.parse_args()
    global WAIT_SECONDS
    if getattr(a, 'wait_seconds', 0):
        WAIT_SECONDS = max(20, a.wait_seconds)
    if a.cmd == 'start':
        return cmd_start(a)
    if a.cmd == 'wait':
        return cmd_wait(a)
    if a.cmd == 'finish':
        return cmd_finish(a)
    if a.cmd == 'fail':
        return cmd_fail(a)
    if a.cmd == 'show':
        return cmd_show(a)
    if a.cmd == 'cleanup':
        out('Removed: ' + (', '.join(cleanup()) or 'nothing'))
        return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
