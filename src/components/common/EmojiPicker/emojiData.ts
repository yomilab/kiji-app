export interface EmojiItem {
  emoji: string;
  label: string;
  category: string;
}

export const EMOJI_LIST: EmojiItem[] = [
  // Faces & Expressions
  { emoji: '😀', label: 'Grinning', category: 'faces' },
  { emoji: '😊', label: 'Smiling', category: 'faces' },
  { emoji: '😎', label: 'Cool', category: 'faces' },
  { emoji: '🤔', label: 'Thinking', category: 'faces' },
  { emoji: '😴', label: 'Sleeping', category: 'faces' },
  { emoji: '🤓', label: 'Nerd', category: 'faces' },
  { emoji: '😇', label: 'Angel', category: 'faces' },
  { emoji: '🤩', label: 'Star-struck', category: 'faces' },

  // Symbols & Objects
  { emoji: '📰', label: 'Newspaper', category: 'objects' },
  { emoji: '📱', label: 'Phone', category: 'objects' },
  { emoji: '💻', label: 'Laptop', category: 'objects' },
  { emoji: '📚', label: 'Books', category: 'objects' },
  { emoji: '📖', label: 'Book', category: 'objects' },
  { emoji: '✉️', label: 'Envelope', category: 'objects' },
  { emoji: '📧', label: 'Email', category: 'objects' },
  { emoji: '📝', label: 'Memo', category: 'objects' },
  { emoji: '🎨', label: 'Art', category: 'objects' },
  { emoji: '🎭', label: 'Theater', category: 'objects' },
  { emoji: '🎬', label: 'Movie', category: 'objects' },
  { emoji: '🎮', label: 'Game', category: 'objects' },
  { emoji: '🎯', label: 'Target', category: 'objects' },
  { emoji: '🎪', label: 'Circus', category: 'objects' },
  { emoji: '🔔', label: 'Bell', category: 'objects' },
  { emoji: '🔖', label: 'Bookmark', category: 'objects' },
  { emoji: '🏆', label: 'Trophy', category: 'objects' },
  { emoji: '⚡', label: 'Lightning', category: 'symbols' },
  { emoji: '⭐', label: 'Star', category: 'symbols' },
  { emoji: '🌟', label: 'Glowing Star', category: 'symbols' },
  { emoji: '💡', label: 'Bulb', category: 'symbols' },
  { emoji: '🔥', label: 'Fire', category: 'symbols' },
  { emoji: '💧', label: 'Droplet', category: 'symbols' },
  { emoji: '🌈', label: 'Rainbow', category: 'symbols' },
  { emoji: '☀️', label: 'Sun', category: 'symbols' },
  { emoji: '🌙', label: 'Moon', category: 'symbols' },
  { emoji: '⚙️', label: 'Gear', category: 'symbols' },
  { emoji: '🔧', label: 'Wrench', category: 'symbols' },
  { emoji: '🔨', label: 'Hammer', category: 'symbols' },

  // Nature & Animals
  { emoji: '🌸', label: 'Cherry Blossom', category: 'nature' },
  { emoji: '🌺', label: 'Hibiscus', category: 'nature' },
  { emoji: '🌻', label: 'Sunflower', category: 'nature' },
  { emoji: '🌲', label: 'Tree', category: 'nature' },
  { emoji: '🍃', label: 'Leaf', category: 'nature' },
  { emoji: '🐱', label: 'Cat', category: 'nature' },
  { emoji: '🐶', label: 'Dog', category: 'nature' },
  { emoji: '🦊', label: 'Fox', category: 'nature' },
  { emoji: '🐼', label: 'Panda', category: 'nature' },
  { emoji: '🦄', label: 'Unicorn', category: 'nature' },
  { emoji: '🦋', label: 'Butterfly', category: 'nature' },
  { emoji: '🐝', label: 'Bee', category: 'nature' },

  // Activities & Food
  { emoji: '⚽', label: 'Soccer', category: 'activities' },
  { emoji: '🏀', label: 'Basketball', category: 'activities' },
  { emoji: '🎵', label: 'Music', category: 'activities' },
  { emoji: '🎸', label: 'Guitar', category: 'activities' },
  { emoji: '🎹', label: 'Piano', category: 'activities' },
  { emoji: '✈️', label: 'Airplane', category: 'activities' },
  { emoji: '🚀', label: 'Rocket', category: 'activities' },
  { emoji: '☕', label: 'Coffee', category: 'food' },
  { emoji: '🍕', label: 'Pizza', category: 'food' },
  { emoji: '🍔', label: 'Burger', category: 'food' },
  { emoji: '🍎', label: 'Apple', category: 'food' },
  { emoji: '🍊', label: 'Orange', category: 'food' },
  { emoji: '🍇', label: 'Grapes', category: 'food' },
  { emoji: '🎂', label: 'Cake', category: 'food' },
  { emoji: '🍰', label: 'Shortcake', category: 'food' },

  // Business & Work
  { emoji: '💼', label: 'Briefcase', category: 'objects' },
  { emoji: '📊', label: 'Chart', category: 'objects' },
  { emoji: '📈', label: 'Trending Up', category: 'objects' },
  { emoji: '📉', label: 'Trending Down', category: 'objects' },
  { emoji: '💰', label: 'Money Bag', category: 'objects' },
  { emoji: '💳', label: 'Credit Card', category: 'objects' },
  { emoji: '🎓', label: 'Graduation', category: 'objects' },
  { emoji: '🔬', label: 'Microscope', category: 'objects' },
  { emoji: '🔭', label: 'Telescope', category: 'objects' },
  { emoji: '🗂️', label: 'Card Index', category: 'objects' },
  { emoji: '📁', label: 'Folder', category: 'objects' },
];

export const EMOJI_CATEGORIES = ['faces', 'symbols', 'objects', 'nature', 'activities', 'food'];
