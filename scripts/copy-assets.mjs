import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('dist/renderer', { recursive: true })
for (const f of ['index.html', 'styles.css']) cpSync(`src/renderer/${f}`, `dist/renderer/${f}`)
cpSync('build/icon.png', 'dist/renderer/icon.png')
cpSync('i18n', 'dist/i18n', { recursive: true })
// vista previa del menú de arranque: las mismas imágenes del tema que se copian al USB
cpSync('boot-theme/poxi', 'dist/renderer/boot', { recursive: true, filter: f => !/fonts|theme\.txt$/.test(f) })
mkdirSync('dist/renderer/fonts', { recursive: true })
cpSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'dist/renderer/fonts/inter-latin-wght-normal.woff2')
