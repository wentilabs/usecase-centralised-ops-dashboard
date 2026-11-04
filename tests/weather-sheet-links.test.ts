import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLinks } from '../lib/card-summary/links';
import { hazeFieldProvider } from '../lib/field-spec/providers/haze';
import { lightningFieldProvider } from '../lib/field-spec/providers/lightning';

test('weather log links require a usable ID; placeholders never produce null pills', () => {
  for (const service of ['haze', 'lightning'] as const) {
    for (const value of [null, undefined, '', ' ', '-', 'null', 'undefined', 'empty', 'not a sheet']) {
      assert.deepEqual(autoLinks(service, { google_sheet_id: value }), []);
    }
    const id = 'abcDEF123_'.repeat(4);
    for (const value of [id, `https://docs.google.com/spreadsheets/d/${id}/edit`]) {
      const links = autoLinks(service, { google_sheet_id: value });
      assert.equal(links.length, 1);
      assert.equal(links[0].label, service === 'haze' ? '📗 Haze log' : '📗 Lightning log');
      assert.equal(links[0].href, `https://docs.google.com/spreadsheets/d/${id}/edit`);
    }
  }
});

test('both service editors offer an optional destination in Sheets', () => {
  for (const provider of [hazeFieldProvider, lightningFieldProvider]) {
    assert.equal(provider.fields.google_sheet_id.widget, 'sheet');
    assert.ok(provider.groups.some(group => group.fields.includes('google_sheet_id')));
  }
});
