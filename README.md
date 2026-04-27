# ⚙️ Metal Shop Timer

A time tracking app built for a metal working shop. Track hours spent on individual jobs so you can fairly allocate and charge time to each client.

---

## What It Does

- **Clock In / Clock Out** to track your total work session
- **Add jobs** by name (e.g. client name, home address, company name)
- **Click a job** to start its timer — clicking another job automatically stops the previous one
- **General time** is tracked automatically whenever you're clocked in but not on a specific job (e.g. shop cleanup, admin, unallocated work)
- **Export to CSV** to get a summary of all job times for invoicing
- **Persists between sessions** — closing the browser won't lose your data

---

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) (dev server + bundler)
- CSS Modules (scoped component styles)
- `localStorage` for persistence

---

## Getting Started

### Prerequisites

- Node.js (via [nvm](https://github.com/nvm-sh/nvm))
- [pnpm](https://pnpm.io/)

### Install & Run

```bash
# Clone the repo
gh repo clone l33t5p33k/job-tracker-app

# Navigate into it
cd job-tracker-app

# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Developer Setup Tips

### Git Aliases

Speed up your git workflow by adding these aliases to your `~/.gitconfig`:

```ini
[alias]
	st = status
	co = checkout
	br = branch
	psho = push origin
	pro = pull --rebase origin
	a = add --all
```

Now instead of typing `git status` you type `git st`, `git push origin HEAD` becomes `git psh`, etc.

### Colorized Terminal Prompt with Git Branch

Add this to your `~/.zshrc` to get a color-coded prompt that shows your current folder and git branch:

```bash
# Git branch in prompt
git_branch() {
  git symbolic-ref --short HEAD 2>/dev/null
}

# Colors
autoload -U colors && colors

# Custom prompt: cyan folder, magenta branch, green ❯
setopt PROMPT_SUBST
PROMPT='%{$fg[cyan]%}%3~%{$reset_color%} %{$fg[magenta]%}$(git_branch)%{$reset_color%} %{$fg[green]%}❯%{$reset_color%} '
```

Your prompt will look like:

```
~/Developer/job-tracker-app main ❯
```

Then reload your terminal config:

```bash
source ~/.zshrc
```
