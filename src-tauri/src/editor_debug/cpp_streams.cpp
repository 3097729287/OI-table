#include <cstdio>

// Keep program streams separate from GDB/MI. MinGW GDB does not apply shell redirections.
__attribute__((constructor)) static void redirect_debug_streams() {
    std::freopen("input.txt", "rb", stdin);
    std::freopen("output.txt", "wb", stdout);
    std::freopen("error.txt", "wb", stderr);
    std::setvbuf(stdout, nullptr, _IONBF, 0);
}
