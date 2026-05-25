/**
 * 時流インサイト・ログ (Insight Intake) - Google Apps Script
 * version: 1.2
 *
 * 役割:
 *   1) doPost           - クライアントからの行書き込み (articles/memos/feeds 等)
 *   2) doGet?sheet=X    - 指定シート全件をJSONで返す (マルチ端末同期)
 *   3) doGet?fetch=URL  - サーバ側からRSS等を取得 (ブラウザのCORS回避プロキシ)
 *
 * 使い方は同梱の SETUP.md を参照。
 *
 * セキュリティ注意:
 *  - このWebアプリを「全員 (匿名含む)」に公開した場合、URLを知る誰でも
 *    書き込み/読み出し/外部URL取得が可能になります。
 *  - 個人利用に留め、URLを公開しないでください。
 *  - 機密情報の取り扱いには使わないでください。
 *  - RSSプロキシ機能 (fetch) は GAS の UrlFetchApp の1日あたり実行クォータに
 *    依存します (Google アカウント種別によって異なります)。
 */

/* ============================================================
   書き込み: POST {sheet, row}
   ============================================================ */
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActive();
    var data = JSON.parse(e.postData.contents);
    var sheetName = data.sheet;
    var row = data.row;
    if (!sheetName || !row) return _json({ok:false, error:"sheet/row が必要です"});

    var sh = ss.getSheetByName(sheetName);
    if (!sh) sh = ss.insertSheet(sheetName);

    // ヘッダ行を準備 (既存があれば再利用、無ければrowのキー)
    var headers = sh.getLastRow() > 0
      ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      : Object.keys(row);
    if (sh.getLastRow() === 0) sh.appendRow(headers);

    // 未知のキーをヘッダに追記
    Object.keys(row).forEach(function(k) {
      if (headers.indexOf(k) === -1) headers.push(k);
    });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);

    // 行を組み立て (配列は "|" 区切り、オブジェクトはJSON化)
    var arr = headers.map(function(h) {
      var v = row[h];
      if (Array.isArray(v)) v = v.join("|");
      if (v === undefined || v === null) v = "";
      return typeof v === "object" ? JSON.stringify(v) : v;
    });
    sh.appendRow(arr);

    return _json({ok:true, sheet:sheetName});
  } catch (err) {
    return _json({ok:false, error: String(err && err.message || err)});
  }
}

/* ============================================================
   読み出し / RSSプロキシ
   ============================================================ */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    // --- (a) RSS取得プロキシ: ?fetch=URL ---
    if (params.fetch) {
      var url = params.fetch;
      // http/https のみ許可
      if (!/^https?:\/\//i.test(url)) {
        return _json({ok:false, error:"URLはhttp(s)である必要があります"});
      }
      var res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true
      });
      var code = res.getResponseCode();
      if (code !== 200) {
        return _json({ok:false, error: "HTTP " + code});
      }
      return _json({ok:true, xml: res.getContentText()});
    }

    // --- (b) シート読み出し: ?sheet=NAME ---
    if (params.sheet) {
      var ss = SpreadsheetApp.getActive();
      var sh = ss.getSheetByName(params.sheet);
      if (!sh || sh.getLastRow() === 0) return _json({ok:true, rows:[]});

      var values = sh.getDataRange().getValues();
      var headers = values[0];
      var rows = values.slice(1).map(function(r) {
        var o = {};
        headers.forEach(function(h, i) { o[h] = r[i]; });
        return o;
      });
      return _json({ok:true, rows: rows});
    }

    return _json({
      ok: false,
      error: "sheet または fetch のどちらかのパラメータが必要です",
      version: "1.2"
    });
  } catch (err) {
    return _json({ok:false, error: String(err && err.message || err)});
  }
}

/* ============================================================
   ヘルパ
   ============================================================ */
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   動作確認用 (任意): メニューから「動作テスト」を実行
   ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("時流インサイト")
    .addItem("シート一覧を表示", "listSheets_")
    .addToUi();
}
function listSheets_() {
  var ss = SpreadsheetApp.getActive();
  var names = ss.getSheets().map(function(s) { return s.getName() + ":" + s.getLastRow(); });
  SpreadsheetApp.getUi().alert("シート一覧\n\n" + names.join("\n"));
}
