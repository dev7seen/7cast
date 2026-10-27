const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = path.join(__dirname, '..', 'public', 'assets', 'sample_match_frame.jpg');

const fontPath = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'LamaSans-Bold.otf').replace(/\\/g, '/').replace(/:/g, '\\:');

const cmd = `ffmpeg -f lavfi -i "color=c=#14532d:s=1920x1080:d=0.04" -vf "drawbox=x=0:y=0:w=1920:h=320:color=#1e293b@0.95:t=fill,drawbox=x=0:y=318:w=1920:h=6:color=#ffffff@0.85:t=fill,drawbox=x=300:y=320:w=1320:h=760:color=#15803d@0.95:t=fill,drawbox=x=955:y=320:w=10:h=760:color=#ffffff@0.85:t=fill,drawbox=x=70:y=60:w=440:h=60:color=#020617@0.9:t=fill,drawbox=x=70:y=60:w=130:h=60:color=#ffffff@0.95:t=fill,drawbox=x=200:y=60:w=80:h=60:color=#1d4ed8@1:t=fill,drawbox=x=280:y=60:w=50:h=60:color=#0f172a@1:t=fill,drawbox=x=330:y=60:w=50:h=60:color=#0f172a@1:t=fill,drawbox=x=380:y=60:w=130:h=60:color=#0369a1@1:t=fill,drawtext=fontfile='${fontPath}':text='23\\:17':fontsize=30:fontcolor=black:x=88:y=76,drawtext=fontfile='${fontPath}':text='BAR':fontsize=28:fontcolor=white:x=215:y=77,drawtext=fontfile='${fontPath}':text='1':fontsize=32:fontcolor=white:x=298:y=75,drawtext=fontfile='${fontPath}':text='0':fontsize=32:fontcolor=white:x=348:y=75,drawtext=fontfile='${fontPath}':text='PSG':fontsize=28:fontcolor=white:x=415:y=77" -frames:v 1 -q:v 2 "${target}" -y`;

try {
  execSync(cmd);
  console.log('Sample match frame generated successfully at:', target);
} catch (e) {
  console.error('Error generating frame:', e.message);
}
