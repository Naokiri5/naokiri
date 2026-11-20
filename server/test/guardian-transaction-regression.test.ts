import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers.js';
import { all, inTransaction, run } from '../src/db/db.js';
import { audit } from '../src/core/audit.js';
import { bus } from '../src/core/bus.js';
import { config } from '../src/config.js';
import { setSetting } from '../src/core/settings.js';
import * as providerHttp from '../src/providers/http.js';
import '../src/providers/pending.js';
import { alertOnce, alertSettings, MAX_ALERTS_PER_HOUR, setAlerts } from '../src/security/guardian/alerts.js';
import { assessAll } from '../src/security/guardian/response.js';
import { guardianPass } from '../src/security/guardian/runner.js';

const NOW = 1_800_000_000_000;
const notifications = () => all("SELECT id FROM notifications WHERE source='guardian'");
const raiseIncident = () => audit('worker-review', 'control.update', { from: { mode: 'PAPER' }, to: { mode: 'APPROVAL' } });
function rejectAlertCommit() {
  run('CREATE TABLE review_parent (id INTEGER PRIMARY KEY)');
  run('CREATE TABLE review_child (id INTEGER REFERENCES review_parent(id) DEFERRABLE INITIALLY DEFERRED)');
  run('CREATE TRIGGER reject_alert_commit AFTER INSERT ON notifications BEGIN INSERT INTO review_child VALUES (1); END');
}

describe('Guardian alert durability', () => {
  beforeEach(() => {
    freshDb();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('MIA_GUARDIAN_AUTOPAUSE', '0');
    setAlerts(true, NOW - 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('alerts the owner when opt-in containment fails to write', () => {
    vi.stubEnv('MIA_GUARDIAN_AUTOPAUSE', '1');
    raiseIncident();
    run("CREATE TRIGGER reject_control_insert BEFORE INSERT ON settings WHEN NEW.key='control' BEGIN SELECT RAISE(ABORT,'simulated control failure'); END");
    run("CREATE TRIGGER reject_control_update BEFORE UPDATE ON settings WHEN NEW.key='control' BEGIN SELECT RAISE(ABORT,'simulated control failure'); END");

    expect(guardianPass().alerted).toHaveLength(1);
    expect(notifications()).toHaveLength(1);
    expect(all("SELECT key FROM settings WHERE key='guardian_handled_evidence'")).toHaveLength(0);
  });

  it('does not broadcast a Guardian alert that could not commit', () => {
    raiseIncident();
    rejectAlertCommit();
    const onAlert = vi.fn();
    bus.on('notification', onAlert);
    try {
      expect(() => alertOnce(assessAll())).toThrow(/FOREIGN KEY/);
      expect(notifications()).toHaveLength(0);
      expect(all("SELECT key FROM settings WHERE key='guardian_alerted_evidence'")).toHaveLength(0);
      expect(all("SELECT id FROM audit_log WHERE action='security.guardian.alert_queued'")).toHaveLength(0);
      expect(onAlert).not.toHaveBeenCalled();
    } finally {
      bus.off('notification', onAlert);
    }
  });

  it('submits to the configured Telegram transport only after a successful retry commits', async () => {
    const telegram = {
      telegramBotToken: config.telegramBotToken,
      telegramChatId: config.telegramChatId,
    };
    Object.assign(config, { telegramBotToken: 'notification-fixture', telegramChatId: 'owner-fixture' });
    const request = vi.spyOn(providerHttp, 'fetchProvider').mockResolvedValue({});
    try {
      raiseIncident();
      const incidents = assessAll();
      rejectAlertCommit();
      expect(() => alertOnce(incidents)).toThrow(/FOREIGN KEY/);
      expect(request).not.toHaveBeenCalled();

      run('DROP TRIGGER reject_alert_commit');
      expect(alertOnce(incidents)).toHaveLength(1);
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]?.[0]).toBe('telegram');
      await request.mock.results[0]?.value;
      expect(notifications()).toHaveLength(1);
    } finally {
      Object.assign(config, telegram);
      request.mockRestore();
    }
  });

  it('broadcasts a committed alert outside its SQLite transaction', () => {
    raiseIncident();
    const onAlert = vi.fn(() => ({ insideTransaction: inTransaction(), rows: notifications().length }));
    bus.on('notification', onAlert);
    try {
      expect(alertOnce(assessAll())).toHaveLength(1);
      expect(onAlert).toHaveBeenCalledOnce();
      expect(onAlert).toHaveReturnedWith({ insideTransaction: false, rows: 1 });
    } finally {
      bus.off('notification', onAlert);
    }
  });

  it('keeps the hourly limit and alerts on the oldest eligible evidence first', () => {
    for (let n = 0; n < MAX_ALERTS_PER_HOUR + 1; n++) {
      vi.setSystemTime(NOW + n);
      raiseIncident();
    }
    const incidents = assessAll();
    const oldestFirst = incidents.slice().reverse().map(({ event }) => event.evidenceId);
    expect(alertOnce(incidents)).toEqual(oldestFirst.slice(0, MAX_ALERTS_PER_HOUR));
    expect(notifications()).toHaveLength(MAX_ALERTS_PER_HOUR);
  });

  it('prioritizes pending critical evidence over older warnings within the shared cap', () => {
    for (let n = 0; n < MAX_ALERTS_PER_HOUR; n++) {
      audit('guardian', 'news.injection', { fixture: n });
    }
    vi.setSystemTime(NOW + 1);
    raiseIncident();
    const incidents = assessAll();
    const critical = incidents.find(({ assessment }) => assessment.severity === 'P0')!;
    const sent = alertOnce(incidents);
    expect(sent).toHaveLength(MAX_ALERTS_PER_HOUR);
    expect(sent[0]).toBe(critical.event.evidenceId);
  });

  it('does not repeat a committed alert after its old cache marker is evicted', () => {
    raiseIncident();
    const incidents = assessAll();
    expect(alertOnce(incidents)).toHaveLength(1);
    setSetting('guardian_alerted_evidence', Array.from({ length: 200 }, (_, n) => `audit:${1000 + n}`));
    vi.setSystemTime(NOW + 3_600_001);

    expect(alertOnce(incidents)).toEqual([]);
    expect(notifications()).toHaveLength(1);
  });

  it('keeps alert settings in effect when their owner audit write fails', () => {
    run("CREATE TRIGGER reject_alert_setting_audit BEFORE INSERT ON audit_log WHEN NEW.action='security.guardian.alerts' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END");
    expect(() => setAlerts(false)).toThrow('simulated audit failure');
    expect(alertSettings()).toEqual({ telegram: true, enabledAt: NOW - 1000 });
  });

  it('still contains a critical incident when the alert settings cannot be read', () => {
    vi.stubEnv('MIA_GUARDIAN_AUTOPAUSE', '1');
    run("UPDATE settings SET value='invalid JSON' WHERE key='guardian_alerts'");
    raiseIncident();
    expect(guardianPass().containment?.action).toBe('PAUSED');
    expect(notifications()).toHaveLength(0);
  });
});
