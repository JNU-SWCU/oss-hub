BEGIN;
DO $reconcile$
DECLARE
  expected jsonb := $mapping$[
  {
    "name": "20260711091820_init",
    "old": "1be076b90c5bf7ef2f6f540682cb9f755de19ed9ca4f30f442604c26506299f2",
    "new": "9ec150b683918eb2a004d3acdc5ed7ba1e2430e0d103c011fd92306c42ef7beb"
  },
  {
    "name": "20260714153856_add_user",
    "old": "33489e8625998f0c5f56f3fd08c5df94e651bd2c34ec84e3b01af9f1912bb8b0",
    "new": "03078d70b65e1f1ce5ed6e74198dcb524fb68bc28cd2041f81d03093dfab3283"
  },
  {
    "name": "20260714161717_add_collection_run",
    "old": "d6651dc977df9910ef3c49cd8d150b806594f6ffb9720cc2a96173eee74a5f97",
    "new": "a47d51dfcbad93b2b6b221beb36c13fff0e9093c43e9040442061e05ce8a3fa9"
  },
  {
    "name": "20260715133000_add_collection_run_start_gate",
    "old": "49a32a4f7480adac26a3a6ff9994b63374f55980b2e1f61f6d08a3010c24ed6f",
    "new": "f93f61209776a5f7ded17b674f454e2e12eb11002a0cc86ba3b090b04aff5a66"
  },
  {
    "name": "20260718144445_remove_member",
    "old": "3174a865bf13683f25eb6039b16fae78e9977a219c5c74023a4be0e6d3319792",
    "new": "2c3eb1e6d4072a8fcaf3a028856c0fdba30b6c643758c0f5a5e936600d1cf903"
  },
  {
    "name": "20260719140111_core_schema_1",
    "old": "d5b3bdd7877436de1ee662423f5fbeecc196d3a275ef7a529a9a6e21bb5fd8b1",
    "new": "7ee8f96aa9700d745af4e3bcad40564a2dc2cc86c8349bcfebbdd09887151c3d"
  },
  {
    "name": "20260719145524_core_schema_2",
    "old": "b5ed4835a5811cf2ea093f3437b32cd4b2761296736abc2d2242d2ebaad83d60",
    "new": "cab1b2b7584ab30d90c1588f5e3d06ef56921667a1d4b78a24f7a65a33a7816e"
  },
  {
    "name": "20260720034625_core_schema_invariants",
    "old": "2351ef3ccc491c759c1bf3f2b614dbaeb06b038744e450d6509c808d8807779b",
    "new": "786173d234df6485c48c43b937d83dcbf14f046c95fa320474aa94cb349b31f9"
  },
  {
    "name": "20260721170000_add_login_history",
    "old": "3ff25e276c88c6296b645fb344d63b1c8b3bf075b1ce4a45d5249acdf1455eba",
    "new": "38b97df48ad60c2a9420dbb1b9a1f55a098c5b6d8200e887038f02ca0183eaa4"
  },
  {
    "name": "20260721173000_add_org_repository_inventory",
    "old": "522fc7efd1b9cff8d18384f547e0f9126116c239b693100a0c7a2babb7db4a45",
    "new": "3074c8b0110668c5e94a2df3c32216ef5b0041e6f340bb5db07843413ca73b1e"
  },
  {
    "name": "20260721190000_add_user_account_status",
    "old": "747332ad45c3f840a1808f9b95ec7f1b1ce220de95c428da9e026cf26e9d7adb",
    "new": "afdf6b1f89f254fd0651a4e6981631a21dbdaaeacd717906efd488388a32cb57"
  },
  {
    "name": "20260722020000_add_repository_owner_projection",
    "old": "aa0fd080366470428b52fa4638e52c1dcb5efc05313ce24c06e06b903466653c",
    "new": "aa0fd080366470428b52fa4638e52c1dcb5efc05313ce24c06e06b903466653c"
  },
  {
    "name": "20260722134000_add_user_onboarding_profile",
    "old": "ebfad9ce62885a904d1d72d584cd195c780704804ee31cbc2b5f4e5bb7819dd9",
    "new": "ebfad9ce62885a904d1d72d584cd195c780704804ee31cbc2b5f4e5bb7819dd9"
  },
  {
    "name": "20260723030000_add_github_webhook_observations",
    "old": "7d5023d66e1b73ff5b9f7f408b2aae1eb470bf956e3fd1a3f9f9460f2e8e6dca",
    "new": "0088ce3903cfc4e8550297fa889fad28c199a41f1ab79c0d447565a193e4b027"
  },
  {
    "name": "20260724103925_add_notification_settings",
    "old": "303d21e7edb0e35ebb3bde6b617176ae00e65cba4a7c1a94ed0231565ff3f920",
    "new": "7feef0bde378c3876745a914aa840458cfaf842a403fae40d3110c2ab2652bc7"
  },
  {
    "name": "20260725095907",
    "old": "80f4441c5aa70733ad802c3083a7c7118134de860eb4b12b1172969cc240ce4a",
    "new": "d74f40c16858d9d1b82ae3b0aa7133c782cd77e8cb3d8fd7f098b755d45daa0d"
  },
  {
    "name": "20260725112000_notify_enabled_opt_in_default",
    "old": "12490bcbf4e7565ffc2aa6baddfc11af4fe40b0748a2a78eaef0ee4bc174307e",
    "new": "9bee592382f6661cc686bb4bec2285954d2337aeaf4d4ea4da7c36a8ce3e2e80"
  },
  {
    "name": "20260725120000_add_canonical_collection_generation",
    "old": "33144ab1b56b938bbb44326cf22abd1b45772f3a670a7e51d47c53fa64b9b464",
    "new": "33144ab1b56b938bbb44326cf22abd1b45772f3a670a7e51d47c53fa64b9b464"
  },
  {
    "name": "20260726120000_add_program_end_at",
    "old": "cfdfc54a22740cf857c5c48ad4f6cb37c69374f86103888408b1d1beca93cc11",
    "new": "cfdfc54a22740cf857c5c48ad4f6cb37c69374f86103888408b1d1beca93cc11"
  },
  {
    "name": "20260726123000_add_public_showcase_projection",
    "old": "4da345cdbf404d77101ea3a23b3eace0ba3dcfbfda81ca276910838bb5f5646b",
    "new": "a6f595917b86f4996906d440e6d6d95b01bc64ee47ca39333c1f93d904ff7e51"
  },
  {
    "name": "20260726125000_add_submission_file_lifecycle",
    "old": "17c94c5a7eb32fa39ab85de0498024552191456b95359989f27bd307aefd26be",
    "new": "09da5034fce389f16296365275f8b921816f1d04c69f3fd38dd37c70fdb84f8c"
  },
  {
    "name": "20260731120000_add_user_profile_expand",
    "old": "87c62050d781fc47e6dceb061993e0fd9b9c6503e9352d2280281edc19062685",
    "new": "c22836edf2702403eb81b8f98af4f31add789cabdd6635348825fcbf06e36b46"
  },
  {
    "name": "20260731130000_enforce_audit_log_append_only",
    "old": "22db14ba2384e034a712eaa5cc4b358a1359297bebc7a21aa10794d45adc81a2",
    "new": "22db14ba2384e034a712eaa5cc4b358a1359297bebc7a21aa10794d45adc81a2"
  },
  {
    "name": "20260731140000_add_admin_access_read_indexes",
    "old": "6439b7fa7289ceeb361774452e3717155af5fb0e1560a5aaa2f499ca11e4b5f9",
    "new": "6439b7fa7289ceeb361774452e3717155af5fb0e1560a5aaa2f499ca11e4b5f9"
  },
  {
    "name": "20260731150000_add_collection_incremental_schema",
    "old": "774d1b03b6c0add09bd62b4fb6cf9ed7832a98c21042f3bc7e3a61c8ac6b661b",
    "new": "774d1b03b6c0add09bd62b4fb6cf9ed7832a98c21042f3bc7e3a61c8ac6b661b"
  },
  {
    "name": "20260801100000_add_collection_sync_lease",
    "old": "3036ad266a766e316378d802e97a16dbc0b9d52ae3eaf24a76752a3d235e5480",
    "new": "3036ad266a766e316378d802e97a16dbc0b9d52ae3eaf24a76752a3d235e5480"
  },
  {
    "name": "20260801110000_add_collection_cutover_lease",
    "old": "9dd4d9a6297e46fecc6f65da8f271319ae11b9720443821cf3c75363e150a989",
    "new": "9dd4d9a6297e46fecc6f65da8f271319ae11b9720443821cf3c75363e150a989"
  },
  {
    "name": "20260801120000_add_repository_public_pagination_index",
    "old": "7abf8c1734fcdc4bc20b0d1573e46ae4e5b43a9f7801a79f3a25501e5f63beab",
    "new": "bf4e1423a85cf454fc79d83eed66baa6709c267d9d1a3cd2f09eb02ecf47c5d8"
  },
  {
    "name": "20260803090000_add_repository_invitation_reconciliation_count",
    "old": "e796817fbb07fd61c3aee36a57251a41e8b7221e06a094217738c89daa41091c",
    "new": "999040d22b69bc93a5b2947c560d489b5ea4e48145f1179aa940093e40f1b5e4"
  },
  {
    "name": "20260803100000_add_program_lifecycle",
    "old": "7087063ce05f36c79673e719334230a0d3fad23a7b1c718e368ec565cd79f2a3",
    "new": "635f7556e7c625e7c0b2c6a7925afddfa8c617113c74e3137b06e13e4f35fd3b"
  },
  {
    "name": "20260803110000_add_notification_idempotency_key",
    "old": "96bf5859d90639321a978db1e3c148c478642680728a7b2c2b59a0b372cb58f3",
    "new": "96bf5859d90639321a978db1e3c148c478642680728a7b2c2b59a0b372cb58f3"
  },
  {
    "name": "20260804090000_add_user_selected_role",
    "old": "e21adda37ff762d59ca1ab0c0e64fcb216f2ca27585b4fcccb143022a180741a",
    "new": "59fbf91a89a00a57e994e0ac94faf20b4256617b3ca15031b935f99f833cef9d"
  },
  {
    "name": "20260804110314_add_milestone_documents_board_team_invitations",
    "old": "fba058ff73e92285caeecddf21aef068a06a7fe36c33f5a469fa7ad1c886f7d2",
    "new": "d8b21035b51706778cbc6ffc13b45466107da9f6b9d2bd0512fa18de2d4b014a"
  },
  {
    "name": "20260804120000_drop_dead_repository_tables",
    "old": "61630cf7a80f82cf876244c537cb90dcdb5448f52797fffd990cf1ecacff1e0e",
    "new": "d226b6750bf3cd345e4284048517a05cff91dba0e236e1c710c9948a8011f86c"
  },
  {
    "name": "20260804130000_drop_dead_observation_tables",
    "old": "7c00f44ad183d3d3d1c29d89a6190b845c90c0bdcb82826d70f31d5a333999e2",
    "new": "8a5d8058719b3e3699fd185e78e3da73ddc880d8eaabe8783ba2a3a72e06dad7"
  },
  {
    "name": "20260804140000_unify_github_repository",
    "old": "cd6f41df4d007f29fb435969cc79e8aa8715f245e38431eb7eb998928f03126c",
    "new": "b1ea0e50330b08d92f4eb5b32aee247c27af2646e053ac5dd638ac749bca3fee"
  },
  {
    "name": "20260804180000_add_application_repository_connection_mode",
    "old": "a298ee11b86bc30909a9676d8d3bbf42f42cff2869d473037681a7d5bfc210ae",
    "new": "9781bd035b19955ffb6bf1edbaf9fd2bf6f3e6103b4e8bbedf1681fe059450f8"
  },
  {
    "name": "20260804200000_application_require_team",
    "old": "2da1b0eaabf85bbfa15f31047ccd761c2c42b9f25ac5b118d84e67d84655db52",
    "new": "8f9110962f6cf710ae2e8604d5877e3e288f96a71992a4a0e52ab97f1fe11a47"
  },
  {
    "name": "20260809000000_add_milestone_document_review_history",
    "old": "1edc2b12e9f25a39000c7a866b2c3205dff0166c9f166afe7a82ec93d11a831d",
    "new": "df6c720a85803aca8a6634e4f77d4871a563494ac45d684527174142f1202165"
  },
  {
    "name": "20260809010000_add_milestone_document_submission_revision",
    "old": "c685513ad7704cfa3aae19307cfa9a73dfddb471751990b29a15f1d0e00564de",
    "new": "542502ff6612125b3980c0742a262e4e96afc2da04924a544e2536c070177dc3"
  },
  {
    "name": "20260809120000_add_github_repository_queue",
    "old": "1cc56d3e33176019e83498cc4457350a49fccb358efc34a9ed51d48eacfa9936",
    "new": "3d79cb482f60639502b0fb90abd2afd5528d2f70f5c5f4f713b7f97629dfde7c"
  },
  {
    "name": "20260809130000_add_contribution",
    "old": "b3c7f0d50523ea30103ea65b9687622a14a600112ad860ee91027dbf3fe58741",
    "new": "437df14740fe4fded3d77142346f6a2487980b90ee4ce880b8344faedd27e651"
  },
  {
    "name": "20260810060000_add_collection_sweep_history",
    "old": "7f91d95720d0ce0576384852abde1638039ef67cc08f655ffc7840a370777ac3",
    "new": "94414df2f1e44bf995a6152cc81eb62a50e0dd91cb6996a9a79c772651836d0f"
  },
  {
    "name": "20260810120000_add_program_authoring_foundation",
    "old": "08d9ff412329dabbd878fb051f0b55944e01ac8dd65be90d868dc0649006bff0",
    "new": "e3ef02d2e84c9afa93511924416f551b26ef706dafbb29f93ca1ea64582a8bb8"
  },
  {
    "name": "20260810130000_remove_repository_release_submissions",
    "old": "a17e2708449aaae606e564a4dff860c1c1ecf769eab52f24350d79ce326b401a",
    "new": "a17e2708449aaae606e564a4dff860c1c1ecf769eab52f24350d79ce326b401a"
  },
  {
    "name": "20260812000000_unify_repository_into_github_repository",
    "old": "9468e20fd54ddf308a189e609443d78f05bfcc9c75cf9564af4e0d19c5322683",
    "new": "f980af6fcf83c40753ce040ae5bc52402f92610433922fd14ce2cbbc4e3ccc4e"
  },
  {
    "name": "20260812120000_add_program_purge_file_tombstone",
    "old": "817b9818f147cd6daf64ef69cdee7541c682657c8794abb0e455c3a35caf6c75",
    "new": "b427676b5dd0ff047bfd2b72aa1e31048df6c904811ad0c50ac21c26b56918a0"
  },
  {
    "name": "20260812172208_add_program_deletion_protected",
    "old": "a4b69f85a5d97e3826d8334be543fc096274572285ba9bcf0ac2234c46b444d6",
    "new": "4f5ac537770fc06efa779e95f6e60fc38996faf501838becd089a8c8e929655c"
  },
  {
    "name": "20260819090000_add_github_user_activity_history",
    "old": "9a476f63f77e1a313d438f8d8031bcb90520fdf578d1282e2c0cbddc811bbd3c",
    "new": "a1c0ee5420d7ca12ca7f2ed12df507738d9fac2cfb3e4bf2105bfd274dad52fe"
  },
  {
    "name": "20260820000000_drop_canonical_generation_tables",
    "old": "c9c957a37a5ee0f2a40b5e4d61828a4fe4ffa9bd4b5e27057ab0dc7cd89cb363",
    "new": "5d72c63eb8dda91002a3c5298729f30356fbc8c84758ca34cef5256c93898f52"
  },
  {
    "name": "20260821000000_add_member_authority_schema_expand",
    "old": "2adbfa7195fde4c278bf72619fd60c390e467e68e0dd3ffa07af4dd65818f0e5",
    "new": "8df58cd1328b89e52b13a4a268b1d5c20767378a31ab7d4aa99b4fcdcd0844ed"
  },
  {
    "name": "20260823000000_bridge_member_authority",
    "old": "19d6bdc81329ab67144f3d0551953ddfd3f49363929e0beaef4adae61aa16726",
    "new": "9b29de187a766c9b3649b7ef0597efe94454362ff60a3269ccf8f8dff7eef184"
  },
  {
    "name": "20260824000000_contract_member_authority",
    "old": "d7ab3d7d30b686c41464b933f7f8d45476f0e16d4f9e7d20756dcc4040dfccea",
    "new": "4210f8f9e80dddd47c50daff55ce57481ae8f71ccefff90193a5d430490533f0"
  },
  {
    "name": "20260824010000_add_session_version",
    "old": "7561dce7c6c763c8bb0f97ebc21d497bbecebffd75bab5cb6b2d463c6d1e95a4",
    "new": "7561dce7c6c763c8bb0f97ebc21d497bbecebffd75bab5cb6b2d463c6d1e95a4"
  },
  {
    "name": "20260827120000_add_milestone_document_submission_history",
    "old": "8be182c919fa89a9cfb0e7b984cc367a0e4a87e2699f23e0b7ac05239954f7d6",
    "new": "d1280969d3c9e182e218c75c523437977bc5f23afaee2b02914697fac31f12c1"
  },
  {
    "name": "20260829152000_allow_application_operation_overlap",
    "old": "cf835629fc341d5e5bb7d6c157cd6f26e1a07b32a9995197acf3bc167a29e3f3",
    "new": "cf835629fc341d5e5bb7d6c157cd6f26e1a07b32a9995197acf3bc167a29e3f3"
  },
  {
    "name": "20260830050000_expand_legacy_submission_bridge",
    "old": "89932152a0aec8c9510f512cccdda7be5edd53f4f5f0e7eca5cf7f0a747c7834",
    "new": "53aa1cb12696ea179a6003c6d32127dca0334c3e2d9dc8c8140a80dcf5ac962d"
  },
  {
    "name": "20260830100000_bridge_legacy_submissions",
    "old": "b93c523ddca9bf2691e142852400ef887ec37a52dcc5972b3bec874229d16771",
    "new": "7fce1b353e44cf2aff2decbbc0a73d224ac9e746bc6f11a951471cf2528ae5aa"
  },
  {
    "name": "20260830180000_contract_legacy_submissions",
    "old": "ddafd7a89e7821175385dde1a5ba1fd1e640958e878a8e5274a1eb9f80215515",
    "new": "5288c56a5669971a78375902d442472d7aab743d9361face88e6da40ad46c745"
  },
  {
    "name": "20260903120000_add_program_track_type",
    "old": "6f01725aac398f5517539733e935bca05dcf7672b90bce2f7da52a075c698a01",
    "new": "771559464e220f7ecc751607d835640b9ca5149ae5667cfa7b32c975584f8fc1"
  },
  {
    "name": "20260904150000_add_milestone_document_resubmission_due_at",
    "old": "818626f89c91d01167b5e8d3d9257aec744df739b16ecaf8cdfbe1ffec5dd3df",
    "new": "9caa3ea47de194be03d171ba2d3172716a0fc1da1b1bee75c7cdbfa66c1e9d8a"
  },
  {
    "name": "20260906174608_add_user_phone_canonical",
    "old": "bd0ab0e1c6fe8d30765d94f18d23e42e6717c8c2a2e2a2323aeaf3d7590e3cd5",
    "new": "6a059123c24d211f40bbf6a598f8f47b507039d57a96d1b43f79394febadf137"
  },
  {
    "name": "20260908150000_drop_program_deletion_protected",
    "old": "ac641615d3365a0cb65dff68cbc48465d0a1f25940add42e78fed68e0dd22e7f",
    "new": "ac641615d3365a0cb65dff68cbc48465d0a1f25940add42e78fed68e0dd22e7f"
  },
  {
    "name": "20260910060000_add_program_cover",
    "old": "8bbdb04fb6f8d92339397a8991f8eec4d0fb08c3d4bcc81195dfd61b7706ec83",
    "new": "78e0ecba06878ae88dd1886aa8a1f40a156ac1198395f560c212741f3b152b04"
  },
  {
    "name": "20260910074633_repository_access_revocation_states",
    "old": "0c1e3a79b97712d9ca2e6852838d78c2546975088d7ba3bc16a1568348c5d604",
    "new": "881bb0cdbfc9b857c0ae5776fdd364c116b730b070da54ddbff62eeffaa81bd0"
  },
  {
    "name": "20260912090000_add_external_program_cover",
    "old": "27572f6653b9364d110cc2d09f4ebfa1e87bc60956fd0688501d45d6f24cf068",
    "new": "27572f6653b9364d110cc2d09f4ebfa1e87bc60956fd0688501d45d6f24cf068"
  },
  {
    "name": "20260917120000_add_repository_issuance_history",
    "old": "907977c7aadf8ffa06efcb00a717dc13144728ece612b25e676ac521d03cc936",
    "new": "fca9768524197c002af7a04e19a27805767bee80a7f6c6cc3d57ec34988f04ca"
  },
  {
    "name": "20260917130000_add_provision_job_current_event",
    "old": "fad5ec84ffe340a86b916da66daea5e156d57986ad808f024b509dd7843aa686",
    "new": "e888d36de722f84361126fd98f0837d8994940767fc6868a4677b3792d3b6dad"
  },
  {
    "name": "20260917140000_remove_provision_job_repository_unique",
    "old": "8df422a2005f1a81139764c56b4cc913a384a4dd4f036438c42b214f4210bc9e",
    "new": "7b5732c933e3ed2c2082d3156cf3f3f9b5c5365260f048e43f7ddb214586d94e"
  },
  {
    "name": "20260920030000_add_application_review_history",
    "old": "8518190552ca5d72b79f34d0c80f42eda772f47708ec7ea9b5ebf368d29283d8",
    "new": "b3aa95c1e9625273d552d9ece0ee18acca6db2350b05f37fd31c5943bd70302e"
  },
  {
    "name": "20260924090000_add_github_issue_history",
    "old": "eb338a03afd6a647d9831236f734a13424fa35b781e0752ff27e1742bdba7913",
    "new": "0b8034cdcd62cbec0ab4a684ce067c1e0a1d46f8d0efc62c1bdf48c0c24477d4"
  },
  {
    "name": "20260924120000_drop_legacy_projection_tables",
    "old": "f3663acfe6fa43fb759d12f069343b6580c43072d0f8d9ab5a2747b3ba2aeb17",
    "new": "6e6d5afdf5652de41cd1161297a6fc4d67b5e906899aa91b7f4f2e2398a21f01"
  },
  {
    "name": "20260926120000_add_github_repository_outsider_contribution",
    "old": "32bc592361099621aac2570d79ee8c6ecb214f45610f8194f3666229648440a1",
    "new": "4c46a57f80863b8146d85ea616eace9ee0b940bd213c085de07af663763b3370"
  },
  {
    "name": "20260926130000_admin_member_kind",
    "old": "f6f7ba85bea3c55eede4f6eca2eaf5ab1d23b09449be71ba563706d565594636",
    "new": "6d6fd1080e701eb6c1fd7fc2deff92a600bc036e3e68f5b051b5ce4a9f4b432f"
  },
  {
    "name": "20260926190000_add_collection_run_kind_and_issue_count",
    "old": "b59dad3ded44c096ce1ddd0f38e611d9b1fe3479c526db4646063ae5567c4843",
    "new": "652cc2ac487a37049577bf9d9fa27edc8280bf941730e3382c8f54f0d95b0031"
  },
  {
    "name": "20261020000000_document_grace_window",
    "old": "0168ca14cccc14d0a958cb957c7a2494bf0e6e39fd561b52f09376530a92d605",
    "new": "e8009133ef7978ba5cb34a43d6b8a9a635af1398a69fa95cad74b5482dbac5bf"
  },
  {
    "name": "20261020020000_add_application_preparation",
    "old": "7bd90ea994f1e4e5cc38661d8bfe4e26cabcf9ca0c3cbd1f9b5c833610dcf286",
    "new": "d414cccc65fdaa25aa5306a3f85a10e5b82e16d4e1f0a3e84e88a5598d7c35a0"
  }
]$mapping$::jsonb;
  item record;
  active_count bigint;
  current_checksum text;
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NULL THEN
    RETURN;
  END IF;
  LOCK TABLE "_prisma_migrations" IN EXCLUSIVE MODE;
  IF (SELECT count(*) FROM "_prisma_migrations"
      WHERE migration_name = '20261022000000_reconcile_comment_cleanup_checksums'
        AND rolled_back_at IS NULL) > 1 THEN
    RAISE EXCEPTION 'checksum reconciliation: ambiguous reconciliation history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "_prisma_migrations" m
    WHERE m.rolled_back_at IS NULL
      AND m.migration_name <> '20261022000000_reconcile_comment_cleanup_checksums'
      AND (m.finished_at IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(expected) AS e(name text, old text, new text)
        WHERE e.name = m.migration_name
      ))
  ) THEN
    RAISE EXCEPTION 'checksum reconciliation: unexpected active migration history';
  END IF;
  FOR item IN SELECT * FROM jsonb_to_recordset(expected) AS e(name text, old text, new text)
  LOOP
    SELECT count(*), min(checksum) INTO active_count, current_checksum
    FROM "_prisma_migrations"
    WHERE migration_name = item.name AND rolled_back_at IS NULL AND finished_at IS NOT NULL;
    IF active_count <> 1 OR current_checksum NOT IN (item.old, item.new) THEN
      RAISE EXCEPTION 'checksum reconciliation: missing, ambiguous or unknown checksum for %', item.name;
    END IF;
  END LOOP;
  UPDATE "_prisma_migrations" m
  SET checksum = e.new
  FROM jsonb_to_recordset(expected) AS e(name text, old text, new text)
  WHERE m.migration_name = e.name
    AND m.rolled_back_at IS NULL AND m.finished_at IS NOT NULL
    AND m.checksum = e.old AND m.checksum <> e.new;
END
$reconcile$;
COMMIT;
