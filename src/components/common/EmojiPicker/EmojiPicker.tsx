import React from 'react';
import { EMOJI_LIST } from './emojiData';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  selectedEmoji?: string;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onEmojiSelect,
  selectedEmoji,
}) => {
  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
  };

  const handleClearClick = () => {
    onEmojiSelect('');
  };

  return (
    <div className="emoji-picker">
      <div className="emoji-picker-header">
        <span className="emoji-picker-title">Choose an icon</span>
        {selectedEmoji && (
          <button
            className="emoji-picker-clear"
            onClick={handleClearClick}
            title="Clear icon"
          >
            Clear
          </button>
        )}
      </div>
      <div className="emoji-picker-grid">
        {EMOJI_LIST.map((item) => (
          <button
            key={item.emoji}
            className={`emoji-picker-item ${
              selectedEmoji === item.emoji ? 'selected' : ''
            }`}
            onClick={() => handleEmojiClick(item.emoji)}
            title={item.label}
          >
            {item.emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
