// Disposable WinForms oracle. The harness compiles it under its isolated run directory.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class NativeAppProbe {
    static string LogPath;
    static void Record(string kind) {
        File.AppendAllText(LogPath, "{\"at\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            + ",\"kind\":\"" + kind + "\",\"pid\":" + Process.GetCurrentProcess().Id + "}\n");
    }
    [STAThread]
    static void Main() {
        LogPath = Environment.GetEnvironmentVariable("PI_ORB_NATIVE_PROBE_LOG");
        Application.EnableVisualStyles();
        Form form = new Form();
        form.Text = "Pi Orb native probe";
        form.Width = 500;
        form.Height = 340;
        Button button = new Button();
        button.Text = "MARK COMPLETE";
        button.SetBounds(100, 85, 270, 95);
        button.Click += delegate { button.Text = "COMPLETE"; Record("native-click"); };
        form.Controls.Add(button);
        form.Shown += delegate { Record("native-ready"); };
        Application.Run(form);
    }
}
