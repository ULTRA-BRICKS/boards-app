# Repository location

The canonical repository is https://github.com/ultrabricks/boards-app.

Existing clones can update their remote without replacing the working tree:

```sh
git remote set-url origin https://github.com/ultrabricks/boards-app.git
git fetch origin
```

The Bun/Oxc and application-shell work is tracked on `work/bun-shell-quality`. Consult [ROADMAP.md](../ROADMAP.md) and the checks for the exact commit before treating a development change as released. Repository write access, successful CI, and a working public deployment are separate milestones.
