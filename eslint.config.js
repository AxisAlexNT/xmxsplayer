import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'coverage/**', 'design/**', 'src/engine/public/worklets/**', 'src/engine/public/notation/**'] },
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['src/ui/App.vue', 'src/ui/components/BarGridTools.vue', 'src/ui/components/TempoPopover.vue', 'src/ui/components/ConflictBanner.vue', 'src/ui/lanes/PianoRollLane.vue', 'src/ui/lanes/Ruler.vue', 'src/ui/notation/StaffControls.vue', 'src/ui/lanes/StaffLane.vue', 'src/ui/timeline/Timeline.vue'],
    rules: { 'vue/no-bare-strings-in-template': 'error' },
  },
)
