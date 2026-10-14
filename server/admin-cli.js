// Usage: npm run admin -- <username> <new-password> [admin|staff] [Full Name]
// Creates the user or resets the password of an existing one.
import { db, hashPassword } from './db.js';

const [username, password, role = 'admin', ...nameParts] = process.argv.slice(2);
if (!username || !password || password.length < 8 || !['admin', 'staff'].includes(role)) {
  console.log('Использование: npm run admin -- <логин> <пароль (от 8 символов)> [admin|staff] [Имя Фамилия]');
  process.exit(1);
}
const name = nameParts.join(' ') || username;
const ex = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (ex) {
  db.prepare('UPDATE users SET pass_hash=?, role=? WHERE id=?').run(hashPassword(password), role, ex.id);
  console.log(`Пароль пользователя «${username}» обновлён.`);
} else {
  db.prepare('INSERT INTO users(username,name,pass_hash,role) VALUES(?,?,?,?)').run(username, name, hashPassword(password), role);
  console.log(`Пользователь «${username}» (${role}) создан.`);
}
