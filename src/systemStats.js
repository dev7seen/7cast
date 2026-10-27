const os = require('os');

class SystemStats {
  constructor() {
    this.prevCpuTicks = this.getCpuTicks();
    this.currentCpuPercent = 0;

    // Background continuous sampler every 2 seconds
    setInterval(() => {
      this.sampleCpu();
    }, 2000);
  }

  getCpuTicks() {
    const cpus = os.cpus() || [];
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    const total = user + nice + sys + idle + irq;
    return { idle, total };
  }

  sampleCpu() {
    const current = this.getCpuTicks();
    const idleDiff = current.idle - this.prevCpuTicks.idle;
    const totalDiff = current.total - this.prevCpuTicks.total;
    this.prevCpuTicks = current;

    if (totalDiff > 0) {
      const usage = Math.round((1 - idleDiff / totalDiff) * 100);
      this.currentCpuPercent = Math.max(0, Math.min(100, usage));
    }
  }

  getMetrics() {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;

    const totalGb = Math.round((totalMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
    const usedGb = Math.round((usedMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
    const freeGb = Math.round((freeMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
    const memPercent = Math.round((usedMemBytes / totalMemBytes) * 100);

    const cpus = os.cpus() || [];
    const cpuModel = cpus[0] ? cpus[0].model.trim() : 'Unknown CPU';
    const cpuCores = cpus.length;

    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / (3600 * 24));
    const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m`;

    return {
      cpu: {
        usagePercent: this.currentCpuPercent,
        model: cpuModel,
        cores: cpuCores
      },
      ram: {
        totalGb,
        usedGb,
        freeGb,
        usagePercent: memPercent
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: uptimeStr
      }
    };
  }
}

module.exports = new SystemStats();
