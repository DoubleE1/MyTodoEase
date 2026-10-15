using System.Runtime.InteropServices;

// Usage:
//   MyTodoEase.AppBar set <hwnd> <widthPx>   reserve a strip on the right edge of the window's monitor and move the window into it
//   MyTodoEase.AppBar remove <hwnd>          release the strip
// hwnd is the native window handle as a decimal number; width is in physical pixels.

if (args.Length < 2 || !long.TryParse(args[1], out var handle))
{
    Console.Error.WriteLine("usage: set <hwnd> <widthPx> | remove <hwnd>");
    return 2;
}

var hwnd = new IntPtr(handle);
if (!Native.IsWindow(hwnd))
{
    Console.Error.WriteLine("not a window");
    return 3;
}

switch (args[0])
{
    case "set":
        if (args.Length < 3 || !int.TryParse(args[2], out var width) || width <= 0)
        {
            Console.Error.WriteLine("width required");
            return 2;
        }
        return AppBar.Set(hwnd, width) ? 0 : 1;
    case "remove":
        AppBar.Remove(hwnd);
        return 0;
    default:
        Console.Error.WriteLine("unknown command");
        return 2;
}

static class AppBar
{
    const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3;
    const uint ABE_RIGHT = 2;
    const uint WM_USER = 0x0400;
    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

    public static bool Set(IntPtr hwnd, int width)
    {
        // Reserve on the monitor the window currently sits on.
        var monitor = Native.MonitorFromWindow(hwnd, Native.MONITOR_DEFAULTTONEAREST);
        var info = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
        if (!Native.GetMonitorInfo(monitor, ref info))
        {
            Console.Error.WriteLine("monitor info failed");
            return false;
        }
        var screen = info.rcMonitor;

        var data = NewData(hwnd);
        // Registering twice is harmless: ABM_NEW returns false if already registered.
        Native.SHAppBarMessage(ABM_NEW, ref data);

        data.uEdge = ABE_RIGHT;
        data.rc = new Native.RECT { left = screen.right - width, top = screen.top, right = screen.right, bottom = screen.bottom };
        Native.SHAppBarMessage(ABM_QUERYPOS, ref data);   // the shell adjusts for the taskbar and other bars
        data.rc.left = data.rc.right - width;
        Native.SHAppBarMessage(ABM_SETPOS, ref data);

        var ok = Native.SetWindowPos(hwnd, IntPtr.Zero, data.rc.left, data.rc.top,
            data.rc.right - data.rc.left, data.rc.bottom - data.rc.top, SWP_NOZORDER | SWP_NOACTIVATE);
        Console.WriteLine($"{data.rc.left},{data.rc.top},{data.rc.right - data.rc.left},{data.rc.bottom - data.rc.top}");
        return ok;
    }

    public static void Remove(IntPtr hwnd)
    {
        var data = NewData(hwnd);
        Native.SHAppBarMessage(ABM_REMOVE, ref data);
    }

    static Native.APPBARDATA NewData(IntPtr hwnd) => new()
    {
        cbSize = (uint)Marshal.SizeOf<Native.APPBARDATA>(),
        hWnd = hwnd,
        uCallbackMessage = WM_USER + 0x21,
    };
}

static class Native
{
    public const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct APPBARDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
