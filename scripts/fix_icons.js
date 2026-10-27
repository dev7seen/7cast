const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'public', 'assets', 'icons');
const files = fs.readdirSync(iconsDir).filter(f => f.endsWith('.svg'));

console.log(`Processing ${files.length} SVG icon files...`);

for (const file of files) {
  const filePath = path.join(iconsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace dark colors with currentColor
  content = content.replace(/fill="#(030D45|292D32|000000|000|171717|0F172A|1E293B|222222|333333|111111)"/gi, 'fill="currentColor"');
  content = content.replace(/stroke="#(030D45|292D32|000000|000|171717|0F172A|1E293B|222222|333333|111111)"/gi, 'stroke="currentColor"');

  // Ensure root <svg> has color: #ffffff by default so if rendered in <img> it is brilliant white
  if (!content.includes('style=')) {
    content = content.replace('<svg ', '<svg style="color: #ffffff;" ');
  } else {
    content = content.replace(/style="([^"]*)"/, (match, styles) => {
      if (!styles.includes('color:')) {
        return `style="color: #ffffff; ${styles}"`;
      }
      return match;
    });
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('All SVG icons have been updated with currentColor and brilliant white default fallback!');
