/*
 * 管理画面のアカウント管理
 *   npm run admin:user -- 名前            追加（またはパスワード変更）。パスワードを聞かれます
 *   npm run admin:user -- --list          一覧
 *   npm run admin:user -- --delete 名前   削除
 * 自動化用: 環境変数 ADMIN_PASSWORD を設定すると、聞かずにそのパスワードを使います。
 */
const readline = require('readline');
const auth = require('./auth');

const args = process.argv.slice(2);

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // 入力中のパスワードを表示しない
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  if (args[0] === '--list') {
    const users = auth.readUsers();
    console.log(users.length ? users.map((u) => `- ${u.name}（作成 ${u.createdAt || '-'}）`).join('\n') : 'アカウントはまだありません');
    return;
  }
  if (args[0] === '--delete') {
    if (!args[1]) return console.error('削除する名前を指定してください');
    console.log(auth.deleteUser(args[1]) ? `${args[1]} を削除しました` : `${args[1]} は見つかりませんでした`);
    return;
  }
  const name = args[0];
  if (!name || !/^[\w.@-]{2,40}$/.test(name)) {
    console.error('使い方: npm run admin:user -- 名前（半角英数字・. @ - _、2〜40文字）');
    process.exit(1);
  }
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    pw = await ask('パスワード（10文字以上）: ');
    const again = await ask('もう一度: ');
    if (pw !== again) { console.error('パスワードが一致しません'); process.exit(1); }
  }
  if (pw.length < 10) { console.error('パスワードは10文字以上にしてください'); process.exit(1); }
  const exists = auth.readUsers().some((u) => u.name === name);
  auth.setUser(name, pw);
  console.log(exists ? `${name} のパスワードを変更しました` : `${name} を作成しました。/admin からログインできます`);
})();
