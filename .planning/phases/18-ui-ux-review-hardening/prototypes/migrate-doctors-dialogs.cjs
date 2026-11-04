// One-off migration: Doctors.tsx overlays -> shared Modal. Verifies every line it expects
// before changing anything, and throws (writing nothing) if the structure differs.
const fs = require('fs')
const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
const lines = src.split(eol)

const specs = [
  {
    marker: '{doctorModalOpen && (',
    open: 'title={editingDoctor ? \'Edit Doctor Profile\' : \'Add Doctor Profile\'} onClose={() => setDoctorModalOpen(false)} busy={createDoctorMutation.isPending || updateDoctorMutation.isPending} className="max-w-lg"',
    h3: 'id="doctor-modal-title"',
  },
  {
    marker: '{feeModalOpen && (',
    open: 'title={editingFee ? \'Edit Fee Rate\' : \'Add Fee Rate\'} onClose={() => setFeeModalOpen(false)} busy={createFeeMutation.isPending || updateFeeMutation.isPending} className="max-w-md"',
    h3: 'id="fee-modal-title"',
  },
]

const found = specs
  .map((s) => ({ ...s, at: lines.findIndex((l) => l.includes(s.marker)) }))
  .sort((a, b) => b.at - a.at)

for (const s of found) {
  if (s.at < 0) throw new Error(`marker not found: ${s.marker}`)
  const ind = lines[s.at].match(/^\s*/)[0]
  const check = (i, pred, what) => { if (!pred(lines[i])) throw new Error(`${s.marker}: line ${i + 1} is not ${what}: ${lines[i]}`) }
  check(s.at + 1, (l) => l.trim() === '<div', '<div')
  check(s.at + 2, (l) => l.includes('role="dialog"'), 'role=dialog')
  check(s.at + 3, (l) => l.includes('aria-modal'), 'aria-modal')
  check(s.at + 4, (l) => l.includes('aria-labelledby'), 'aria-labelledby')
  check(s.at + 5, (l) => l.includes('fixed inset-0'), 'fixed overlay class')
  check(s.at + 6, (l) => l.trim() === '>', '>')
  check(s.at + 7, (l) => l.includes('className="bg-white'), 'card div')
  check(s.at + 8, (l) => l.includes('<h3') && l.includes(s.h3), `h3 ${s.h3}`)
  check(s.at + 10, (l) => l.includes('</h3>'), '</h3>')

  let e = -1
  for (let i = s.at + 11; i < lines.length; i++) {
    if (lines[i] === `${ind})}`) { e = i; break }
  }
  if (e < 0) throw new Error(`${s.marker}: closing )} not found`)
  check(e - 1, (l) => l.trim() === '</div>', 'wrapper </div>')
  check(e - 2, (l) => l.trim() === '</div>', 'card </div>')

  lines.splice(e - 2, 2, `${ind}</Modal>`)
  lines.splice(s.at + 1, 10, `${ind}  <Modal open ${s.open}>`)
}

const importLine = lines.findIndex((l) => l.startsWith("import { ConflictBanner"))
if (importLine < 0) throw new Error('no anchor import line')
lines.splice(importLine + 1, 0, "import { Modal } from '../components/Modal'")

fs.writeFileSync(file, lines.join(eol), 'utf8')
console.log('migrated', found.length, 'dialogs; eol', JSON.stringify(eol))
