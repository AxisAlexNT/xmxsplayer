xm.on('control', (e) => {
  if (e.id !== 'daw.context1' || !e.pressed || e.edge !== 'press') return
  if (xm.transport.bar < 17 || xm.transport.bar > 32) return
  xm.zones.set([
    {
      id: 'lower',
      lo: 36,
      hi: 83,
      trackIds: ['lower'],
      transpose: 0,
      velocity: 'linear',
      color: '#b07cff',
    },
    {
      id: 'upper',
      lo: 84,
      hi: 95,
      trackIds: ['upper'],
      transpose: 0,
      velocity: 'linear',
      color: '#4cc2ff',
    },
  ])
  xm.patch.set('lower', ['harpsichord', 'glockenspiel'])
  xm.patch.set('upper', ['lead'])
  xm.display('Reprise split', 'Harpsichord + bells')
})
