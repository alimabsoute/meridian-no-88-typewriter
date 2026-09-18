/** Octoberline signup receiver. Deploy from the private subscriber spreadsheet.
 * Script properties: OCTOBERLINE_SHEET_ID, OCTOBERLINE_WEBHOOK_SECRET (32+ chars).
 * Only HMAC-signed requests from the website's server can append a row.
 * No read/list API is exposed and no emails are sent by this script. */
function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeCell_(value) {
  var text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function doPost(event) {
  var lock;
  var locked = false;
  try {
    if (!event || !event.postData || event.postData.contents.length > 4096) return jsonResponse_({ ok: false });
    var settings = PropertiesService.getScriptProperties();
    var secret = settings.getProperty('OCTOBERLINE_WEBHOOK_SECRET');
    var sheetId = settings.getProperty('OCTOBERLINE_SHEET_ID');
    if (!secret || secret.length < 32 || !sheetId) return jsonResponse_({ ok: false });
    var envelope = JSON.parse(event.postData.contents);
    if (typeof envelope.payload !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature)) return jsonResponse_({ ok: false });
    var bytes = Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8);
    var expected = bytes.map(function (value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
    var mismatch = 0;
    for (var index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ envelope.signature.charCodeAt(index);
    if (mismatch !== 0) return jsonResponse_({ ok: false });
    var entry = JSON.parse(envelope.payload);
    if (typeof entry.email !== 'string' || entry.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)
      || entry.consent !== 'updates-v1' || typeof entry.timestamp !== 'number' || Math.abs(Date.now() - entry.timestamp) > 300000
      || typeof entry.source !== 'string' || !/^\/[a-z0-9/_\-.]*$/i.test(entry.source) || entry.source.length > 160
      || typeof entry.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.requestId)) return jsonResponse_({ ok: false });
    lock = LockService.getScriptLock();
    locked = lock.tryLock(5000);
    if (!locked) return jsonResponse_({ ok: false });
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Subscribers');
    if (!sheet) return jsonResponse_({ ok: false });
    var headers = sheet.getRange(1, 1, 1, 6).getDisplayValues()[0];
    if (headers.join('|') !== 'Signed up (UTC)|Email|Source page|Consent|Status|Request ID') return jsonResponse_({ ok: false });
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var existing = sheet.getRange(2, 2, lastRow - 1, 1).createTextFinder(entry.email).matchEntireCell(true).matchCase(false).findNext();
      if (existing) return jsonResponse_({ ok: true });
    }
    var row = lastRow + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    sheet.getRange(row, 1, 1, 6).setNumberFormat('@').setValues([[
      new Date(entry.timestamp).toISOString(), safeCell_(entry.email), safeCell_(entry.source), entry.consent, 'Subscribed', entry.requestId,
    ]]);
    SpreadsheetApp.flush();
    return jsonResponse_({ ok: true });
  } catch (error) {
    return jsonResponse_({ ok: false });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet() { return jsonResponse_({ ok: false }); }
