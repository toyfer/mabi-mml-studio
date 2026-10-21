# MabiMML Studio

MIDI から **マビノギモバイル対応の MML** へ変換する、ビルド不要の静的Webアプリ＋APIです。

- 変換はすべてブラウザ内（MIDIファイルは送信されません）
- GitHub Pages にそのまま置けます
- 同じエンジンを JS API / Cloudflare Worker から呼べます

## 主な機能

| 機能 | 説明 |
| --- | --- |
| MIDI → MML | SMF形式0/1、ランニングステータス、テンポマップに対応 |
| 最大6パート自動割当 | メロディトラックを推定して固定し、残りを音域順にモノフォニック配分 |
| TPQN 960 のtick厳密化 | 3,840tick（全音符）を割り切る音長だけを使用。`l54`などの誤差を回避 |
| テンポ平坦化 | 曲中テンポ変更を実時間のまま1BPMへ。和音パートのテンポ追従バグを回避 |
| 和音のタイ回避 | 和音パートは「音符＋休符」で拍を合わせる（既定） |
| 2,400文字の自動最適化 | `l`／`<`／`>`／`n`の文字数比較、休符の圧縮、クオンタイズ調整 |
| パート分割 | 1パートが上限を超えたら時間方向に分割し、音を欠かさず収める |
| ピアノロール＋試聴 | パート別ミュート、シーク、Web Audioによる簡易再生 |
| 共有リンク | MMLを圧縮してURLハッシュに格納（サーバー不要） |
| ローカル保存 | localStorageに保存・復元 |
| API | ES Modules の JS API と、Cloudflare Worker の REST API |

## 使い方

1. `index.html` を開く（ローカルなら `npm run serve`）
2. MIDIファイルをドロップ
3. 必要ならパート数・楽器・クオンタイズを調整
4. パートごとのMMLをコピー、または `MML@` をまとめてコピー
5. ゲーム内：バッグ → 道具 → 楽譜 → 楽譜編集 → 各パートの［ペースト］

## ローカル開発

ビルドツールは不要です。ES Modules をそのまま読みます。

```bash
npm run serve   # python3 -m http.server 8080
npm test        # Node 18+ で変換エンジンのテスト
```

`file://` で直接開くとモジュールの読み込みがブロックされるため、必ずHTTPサーバー経由で開いてください。

## GitHub Pages へのデプロイ

1. このリポジトリを push
2. Settings → Pages → Source を **GitHub Actions** に設定
3. `.github/workflows/pages.yml` が自動でデプロイ

リポジトリ名がパスに入る場合（`https://user.github.io/repo/`）も、すべて相対パスで動きます。

## REST API（任意）

```bash
npm i -g wrangler
wrangler deploy worker/index.js --name mabi-mml-api --compatibility-date 2026-01-01
```

```bash
curl -X POST https://mabi-mml-api.example.workers.dev/v1/convert \
  -F "midi=@song.mid" -F "parts=6"
```

詳細は `api.html` を参照してください。

## ディレクトリ構成

```
index.html            変換UI
spec.html             マビノギモバイルMML仕様の調査メモ
api.html              APIリファレンス＋MML解析プレイグラウンド
assets/app.css        スタイル
src/core/midi.js      SMFパーサ
src/core/quantize.js  テンポマップ・平坦化・音域処理
src/core/allocate.js  パート割当（メロディ推定＋モノフォニック配分）
src/core/encode.js    MML生成（文字数最適化）
src/core/mml.js       MMLパーサ（検証・試聴用）
src/core/spec.js      制限値・音長テーブル・楽器
src/core/convert.js   変換パイプライン
src/api.js            公開API
src/ui/               UI（プレイヤー、ピアノロール、デモMIDI）
worker/index.js       Cloudflare Worker
tests/                変換エンジンのテスト
```

## 実装メモ

変換は「秒に直してから、目標BPMのtickに戻す」方式です。これによりテンポ変更を消しても実時間が変わりません。

音長は `3,840 ÷ 分母` が整数になる分母だけを使います（`l3` `l5` `l6` `l12` `l24` などの連符も含む）。割り切れない長さは、タイで分割するか「音符＋休符」に分解して次の音の位置を守ります。

文字数調整は「クオンタイズを粗くする → パートを分割する → 音符を削る → 打ち切る」の順です。パート分割は文字数制限がパート単位であることを利用した方法で、1本の旋律が長すぎる場合でも音を失わずに収められます。

## 既知の制限

- ゲームクライアントでの実機再生は未検証です。検証は「生成したMMLを再パースし、音符数・発音位置・音長が一致すること」で行っています。
- 音声（MP3/WAV）からの採譜は未対応です。MIDIのみ。
- 楽器ごとの実音域は未反映です（MML全体の `o0`〜`o8` のみチェック）。
- ドラムトラックは旋律として扱われます。必要ならDAW側で除外してください。
- 共有リンクはURL長の制約を受けます。非常に長い曲は保存ファイルを使ってください。

## 出典

仕様の根拠は `spec.html` にまとめています。主な一次情報：

- [マビノギモバイル 公式ガイド「楽器演奏」](https://mabinogimobile.nexon.co.jp/about/guide/3541657)
- [MabiIcco マニュアル（モバイル向け出力）](https://www.mabicompose.com/lecture02/mabinogi_mobile_clipboard)
- [マビノギモバイルの作曲とバグについて（tick計算・同時発音）](https://edgestorm.tistory.com/513)
- [mmlTools Issue #122（TPQN 960）](https://github.com/fourthline/mmlTools/issues/122)
- [Mabinogi MML Syntax](https://3ml.mabi.tw/en/guide/mml)

## ライセンス

MIT。マビノギモバイルおよびNEXONとは無関係の非公式ツールです。
