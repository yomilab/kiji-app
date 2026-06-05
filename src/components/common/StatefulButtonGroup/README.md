# StatefulButtonGroup

A configurable icon button component with animated state transitions, built with Motion library.

## Features

- **Multiple States**: Support for 2+ button states (toggle, cycle through modes)
- **Directional Animations**: Auto mode slides down when advancing, up when going back
- **Configurable Animations**: 6 animation directions (auto, slide-down, slide-up, slide-left, slide-right, fade, scale)
- **Overflow Clipping**: Old button clips cleanly when sliding out of button bounds
- **Fixed Size**: Button maintains constant width/height during animations
- **Smooth Transitions**: Uses Motion library for smooth, performant animations
- **Fully Typed**: Complete TypeScript support
- **Accessible**: Built-in ARIA labels and keyboard navigation
- **Flexible**: Customizable duration, bounce, and styling

## Usage

### Basic Two-State Toggle

```tsx
import { StatefulButtonGroup, type ButtonState } from '@/components/common/StatefulButtonGroup';
import Icon1 from '@mui/icons-material/Icon1';
import Icon2 from '@mui/icons-material/Icon2';

const MyComponent = () => {
  const [isEnabled, setIsEnabled] = useState(false);

  const states: ButtonState[] = [
    {
      key: 'off',
      icon: <Icon1 sx={{ fontSize: '18px' }} />,
      ariaLabel: 'Turn on',
      title: 'Turn on feature',
    },
    {
      key: 'on',
      icon: <Icon2 sx={{ fontSize: '18px' }} />,
      ariaLabel: 'Turn off',
      title: 'Turn off feature',
    },
  ];

  return (
    <StatefulButtonGroup
      states={states}
      currentStateIndex={isEnabled ? 1 : 0}
      onChange={(nextIndex) => setIsEnabled(nextIndex === 1)}
    />
  );
};
```

### Three-State Cycle

```tsx
const ViewModeToggle = () => {
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'compact'>('list');

  const states: ButtonState[] = [
    { key: 'list', icon: <ListIcon />, ariaLabel: 'List view', title: 'Switch to list view' },
    { key: 'grid', icon: <GridIcon />, ariaLabel: 'Grid view', title: 'Switch to grid view' },
    { key: 'compact', icon: <CompactIcon />, ariaLabel: 'Compact view', title: 'Switch to compact view' },
  ];

  const viewModeToIndex = { list: 0, grid: 1, compact: 2 };
  const indexToViewMode = ['list', 'grid', 'compact'] as const;

  return (
    <StatefulButtonGroup
      states={states}
      currentStateIndex={viewModeToIndex[viewMode]}
      onChange={(nextIndex) => setViewMode(indexToViewMode[nextIndex])}
      animationConfig={{
        direction: 'slide-left',
        duration: 0.15,
      }}
    />
  );
};
```

### Custom Animation

```tsx
<StatefulButtonGroup
  states={myStates}
  currentStateIndex={currentIndex}
  onChange={handleChange}
  animationConfig={{
    direction: 'scale',      // Animation type
    duration: 0.25,          // Animation duration in seconds
    bounce: 0.3,             // Spring bounce (0-1)
  }}
  size="is-medium"           // Size class token
  disabled={isLoading}       // Disable button
  className="my-custom-class"
  data-widget="my-widget"
/>
```

## Props

### `ButtonState`

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Unique identifier for this state |
| `icon` | `React.ReactNode` | Icon component to render |
| `ariaLabel` | `string` | Accessible label for screen readers |
| `title` | `string` | Tooltip text |

### `AnimationConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `direction` | `AnimationDirection` | `'auto'` | Animation direction |
| `duration` | `number` | `0.2` | Animation duration in seconds |
| `bounce` | `number` | `0` | Spring bounce (0-1, only for spring animations) |

**Note:** The component uses tween animations with `easeInOut` easing by default for smooth, linear motion. The `bounce` parameter only applies if you customize the transition type to use springs.

**Animation Directions:**
- `'auto'` - **Recommended**: Automatically slides down when going forward (index increases), slides up when going backward (index decreases)
- `'slide-down'` - New state slides down, old state slides up
- `'slide-up'` - New state slides up, old state slides down
- `'slide-left'` - New state slides from right
- `'slide-right'` - New state slides from left
- `'fade'` - Simple fade transition
- `'scale'` - Scale and fade transition

### `StatefulButtonGroupProps`

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `states` | `ButtonState[]` | ✅ | - | Array of button states |
| `currentStateIndex` | `number` | ✅ | - | Current active state index |
| `onChange` | `(nextIndex: number) => void` | ✅ | - | Callback when button is clicked |
| `animationConfig` | `AnimationConfig` | ❌ | `{ direction: 'auto', duration: 0.2, bounce: 0 }` | Animation configuration |
| `className` | `string` | ❌ | `''` | Additional CSS class |
| `disabled` | `boolean` | ❌ | `false` | Disable button |
| `size` | `'is-small' \| 'is-medium' \| 'is-large'` | ❌ | `'is-small'` | Size class token |
| `isLoading` | `boolean` | ❌ | `false` | Whether the button is in a loading/in-between state (applies scan animation) |
| `data-widget` | `string` | ❌ | - | Custom data attribute |

## Animation Examples

See `StatefulButtonGroup.examples.tsx` for complete examples of:
- Two-state toggles
- Three-state cycles
- All animation directions
- Custom configurations

## Implementation Notes

- **No useEffect bugs**: Uses Motion library's `AnimatePresence` to avoid manual animation state management
- **Automatic cycling**: Button automatically cycles to next state when clicked
- **Directional intelligence**: Auto mode calculates direction during render for immediate response
- **Linear motion**: Uses tween animations with easeInOut for smooth, predictable motion
- **Overflow clipping**: Old button is hidden once it slides out of the button bounds
- **Fixed dimensions**: Button maintains constant size during animations (no layout shifts)
- **Index validation**: Ensures `currentStateIndex` stays within bounds
- **Performant**: Uses hardware-accelerated transforms for smooth animations
- **Follows project guidelines**: Adheres to KiJi animation best practices

## Current Usage in KiJi

- **ArticleView**: Reader mode / basic view toggle with auto animation (slides down when enabling reader mode, slides up when disabling)
