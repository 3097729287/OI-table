#include <cstdio>

#ifdef _WIN32
#include <cstdlib>
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

static void wait_for_debugger() {
    if (!std::getenv("OI_TABLE_DEBUG_WAIT")) {
        return;
    }

    auto *ready = std::fopen("debug-ready", "wb");
    if (!ready || std::fclose(ready) != 0) {
        std::_Exit(EXIT_FAILURE);
    }

    // The app attaches and installs breakpoints while the draft is still at this gate.
    const DWORD started = GetTickCount();
    while (GetFileAttributesA("debug-start") == INVALID_FILE_ATTRIBUTES) {
        if (GetTickCount() - started >= 30000) {
            std::_Exit(EXIT_FAILURE);
        }
        Sleep(10);
    }
}
#endif

// Keep program streams separate from GDB/MI. MinGW GDB does not apply shell redirections.
#ifdef _WIN32
__attribute__((constructor(101)))
#else
__attribute__((constructor))
#endif
static void redirect_debug_streams() {
    std::freopen("input.txt", "rb", stdin);
    std::freopen("output.txt", "wb", stdout);
    std::freopen("error.txt", "wb", stderr);
    std::setvbuf(stdout, nullptr, _IONBF, 0);
#ifdef _WIN32
    wait_for_debugger();
#endif
}
