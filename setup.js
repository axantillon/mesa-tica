import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
mkdirSync('data',{recursive:true,mode:0o700});
const db = new DatabaseSync('data/mesa.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS menu(id TEXT PRIMARY KEY, category TEXT, name TEXT, description TEXT, price INTEGER, available INTEGER, position INTEGER);
CREATE TABLE IF NOT EXISTS employees(username TEXT PRIMARY KEY, name TEXT, salt TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, created TEXT, status TEXT, revision INTEGER, lines TEXT, total INTEGER, reason TEXT);
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, selection TEXT, result TEXT, order_id INTEGER);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT, employee TEXT, time TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT, expires INTEGER);`);
const menu=[['M1','Meals','Chicken casado','Rice, beans, chicken, salad and plantain.',4500,1],['M2','Meals','Vegetarian casado','Rice, beans, vegetables, salad and plantain.',4000,1],['M3','Meals','Fish casado','Rice, beans, fish and salad.',5000,0],['S1','Sides','Beef empanada','Corn pastry filled with seasoned beef.',1500,1],['S2','Sides','Cheese empanada','Corn pastry filled with cheese.',1400,1],['S3','Sides','Garden salad','Lettuce, tomato and cucumber.',2500,1],['S4','Sides','Plantain side','Sweet fried plantain.',1200,1],['D1','Drinks','Horchata','Rice drink, 350 mL.',1300,1],['D2','Drinks','Iced tea','Unsweetened tea, 350 mL.',1000,1]];
const insert=db.prepare('INSERT OR IGNORE INTO menu VALUES(?,?,?,?,?,?,?)'); menu.forEach((x,i)=>insert.run(...x,i));
let credentials=[]; for(const [username,name] of [['luis','Luis'],['elena','Elena']]) { if(!db.prepare('SELECT 1 FROM employees WHERE username=?').get(username)){const password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');db.prepare('INSERT INTO employees VALUES(?,?,?,?)').run(username,name,salt,hash);credentials.push(`${username}: ${password}`)} }
if(credentials.length){let path='data/staff-credentials.txt'; if(existsSync(path)) path=`data/staff-credentials-${Date.now()}.txt`; writeFileSync(path,credentials.join('\n')+'\n',{mode:0o600}); console.log(`New local credentials written to ${path}`)} else console.log('Existing staff accounts preserved.');
console.log('Setup complete; existing orders and menu entries preserved.');
