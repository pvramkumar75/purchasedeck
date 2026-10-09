// One codebase, two apps. Each deployment sets APP_VARIANT to TPL or TCL and gets its
// own units, its own board, and its own uploaded files. Unset keeps the combined app.
const ALL = {
  id: 'ALL',
  name: 'Material Tracking',
  short: 'MatTrack',
  plants: [
    { id: 'TPL', label: 'TPL' },
    { id: 'TCL-JDM', label: 'TCL-JDM' },
    { id: 'TCL-JDCL', label: 'TCL-JDCL' },
    { id: 'TCL', label: 'TCL (JDM+JDCL)' },
  ],
  defaultPlants: { 1100: 'TPL', 1200: 'TCL-JDM', 1300: 'TCL-JDCL' },
}

export const VARIANTS = {
  ALL,
  TPL: {
    id: 'TPL',
    name: 'Material Tracking · TPL',
    short: 'TPL Track',
    plants: [{ id: 'TPL', label: 'TPL' }],
    defaultPlants: { 1100: 'TPL' },
  },
  TCL: {
    id: 'TCL',
    name: 'Material Tracking · TCL',
    short: 'TCL Track',
    plants: ALL.plants.filter((plant) => plant.id !== 'TPL'),
    defaultPlants: { 1200: 'TCL-JDM', 1300: 'TCL-JDCL' },
  },
}

export function variantFor(id) {
  return VARIANTS[String(id || '').trim().toUpperCase()] || ALL
}
