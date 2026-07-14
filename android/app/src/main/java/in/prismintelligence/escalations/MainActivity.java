package in.prismintelligence.escalations;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
    }

    /**
     * High-importance channel used for ticket / SLA push notifications.
     * Must match the `channel_id` sent by the send-push Edge Function and the
     * default channel declared in AndroidManifest.xml.
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    "prism_alerts",
                    "Escalation Alerts",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("New tickets, SLA breaches and escalations");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 150, 250});
            channel.enableLights(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
