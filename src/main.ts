import './style.css';

console.log('🚀 Spoiler Shield is running!');

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <h1>Spoiler Shield</h1>
    <p>Hello World!</p>
    <p>Vite + TypeScript is working 🎉</p>
  `;
}