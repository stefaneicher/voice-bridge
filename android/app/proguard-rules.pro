# kotlinx.serialization: keep generated serializers of protocol classes.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class ch.voicebridge.app.**$$serializer { *; }
-keepclassmembers class ch.voicebridge.app.** {
    *** Companion;
}
