# 📰 KiJi

### A simple, private RSS reader that runs *entirely on your machine.*

KiJi helps you follow feeds, save articles, sync saved reading to a local Markdown folder, and export your data — without tracking, accounts, or algorithmic noise. Your subscriptions, reading state, and saved articles stay in a local SQLite database on your device.

[![Build](https://github.com/yomilab/kiji-app/actions/workflows/build-desktop.yml/badge.svg)](https://github.com/yomilab/kiji-app/actions/workflows/build-desktop.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Data: 100% local](https://img.shields.io/badge/data-100%25%20local-ff8a3d.svg)](#-privacy)

**[kiji.yomilab.app](https://kiji.yomilab.app)** · [Download](https://kiji.yomilab.app/download/)

## ✨ Features

- **🔒 Completely local.** Feeds, articles, saved items, Markdown files, and reading state live in a SQLite database on your machine. KiJi does not collect personal reading data.
- **📥 Portable subscriptions.** Import and export feeds with OPML so your subscriptions stay portable.
- **📝 Markdown sync and exports.** Sync saved articles to a local Markdown folder and export the full saved archive when you want a portable backup.
- **📖 Reader mode.** Clean article reading with saved-article support, typography controls, and distraction-free layout.
- **🏷️ Stations and smart views.** Group feeds into stations; browse All, Unread, and Saved from the sidebar.
- **🖥️ Native desktop shell.** Built with Tauri 2 — frameless window, macOS vibrancy, and platform-native packaging for macOS, Windows, and Linux.

## 🛡️ Privacy

KiJi is **local-first by design.**

- Your feeds, articles, saved items, and reading state stay **on your device** in `kiji.db` and optional local Markdown sync folders.
- There is **no account**, **no telemetry**, and **no reading analytics** in the app.
- Network requests are limited to **fetching RSS/Atom feeds** (and optional update checks when you use the built-in updater).
- OPML import/export and saved-article export give you **portable, user-owned copies** of your data.

## 📋 Status

KiJi is in **active pre-release development** (`0.1.0`). The Tauri desktop app targets **macOS, Windows, and Linux**; cross-platform builds and tests run on every push to `dev` and `main`.

Installers and release notes are published through **[kiji.yomilab.app](https://kiji.yomilab.app)** as builds stabilize ahead of a **1.0** release. Expect rough edges, fast iteration, and breaking changes until then.

<p align="center">
  <sub>📰 KiJi · <a href="https://kiji.yomilab.app">kiji.yomilab.app</a></sub>
</p>
